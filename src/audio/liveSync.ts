import { radioDsp } from './dspEngine';

/**
 * Live-ether phase lock.
 *
 * The server publishes the on-air position; the local <audio> element drifts away from it because of
 * buffering. `LiveClock` turns the server's whole-second positions into a precise local estimate and
 * `LivePhaseLock` steers the element towards it:
 *
 *   |drift| below 0.08 s ........ nothing to do (IN SYNC)
 *   0.25 s … 1.5 s ............... gentle playbackRate nudge (0.985× when ahead, 1.015× when behind)
 *   1.5 s … 3.5 s ................ keep nudging at the maximum rate, never seek (rides out short stalls)
 *   above 3.5 s .................. micro-faded seek (LIVE RESYNC)
 */

export type SyncState = 'idle' | 'in-sync' | 'compensating' | 'resync';

export interface SyncSnapshot {
  state: SyncState;
  /** audio.currentTime − live target, in seconds. Positive: the element is ahead of the ether. */
  driftSec: number;
  playbackRate: number;
}

export const PHASE_LOCK = {
  /** Inside this window the lock is considered converged. */
  DEADBAND_SEC: 0.08,
  /** Drift needed to start compensating (hysteresis against the dead band). */
  ENGAGE_SEC: 0.25,
  /** Above this the rate correction is pinned at its maximum. */
  SOFT_SEC: 1.5,
  /** Above this a (micro-faded) seek replaces rate correction. */
  HARD_SEC: 3.5,
  /** Drift at which the rate nudge reaches its full ±1.5 %. */
  FULL_RATE_AT_SEC: 0.35,
  RATE_AHEAD: 0.985,
  RATE_BEHIND: 1.015,
  /** Max playbackRate change per tick: glides to the target (and back to 1.0×) instead of stepping. */
  RATE_SLEW_PER_TICK: 0.003,
  TICK_MS: 250,
  RESYNC_COOLDOWN_MS: 5000,
  /** How long LIVE RESYNC stays on screen after a seek. */
  RESYNC_HOLD_MS: 1200,
} as const;

export interface PhasePlan {
  action: 'rate' | 'seek';
  targetRate: number;
  compensating: boolean;
}

/** Pure decision function (kept separate so it is trivial to unit test). */
export function planPhaseCorrection(driftSec: number, wasCompensating: boolean): PhasePlan {
  const abs = Math.abs(driftSec);
  if (abs > PHASE_LOCK.HARD_SEC) {
    return { action: 'seek', targetRate: 1, compensating: true };
  }

  const engaged = wasCompensating ? abs >= PHASE_LOCK.DEADBAND_SEC : abs >= PHASE_LOCK.ENGAGE_SEC;
  if (!engaged) {
    return { action: 'rate', targetRate: 1, compensating: false };
  }

  const strength =
    abs >= PHASE_LOCK.SOFT_SEC
      ? 1
      : Math.min(
          1,
          (abs - PHASE_LOCK.DEADBAND_SEC) / (PHASE_LOCK.FULL_RATE_AT_SEC - PHASE_LOCK.DEADBAND_SEC)
        );
  const fullRate = driftSec > 0 ? PHASE_LOCK.RATE_AHEAD : PHASE_LOCK.RATE_BEHIND;
  return { action: 'rate', targetRate: 1 + (fullRate - 1) * strength, compensating: true };
}

/**
 * Local estimate of the server's broadcast clock.
 *
 * The server reports `positionSec` floored to whole seconds, which would inject ±0.5 s of noise into the
 * phase lock. A set's start time is constant, and every observation bounds it to a 1-second interval, so
 * intersecting the intervals of successive observations converges on the true sub-second phase.
 */
export class LiveClock {
  private offsetSamples: number[] = [];
  private offsetMs = 0;
  private key = '';
  private lo = -Infinity;
  private hi = Infinity;
  private hasFix = false;

  /**
   * Feeds a (serverTime − localTime) sample. Network latency only ever makes the sample smaller, so the
   * best estimate of the real offset is the maximum of the recent samples.
   */
  public observeOffset(sampleMs: number): void {
    if (!Number.isFinite(sampleMs)) return;
    if (this.offsetSamples.length > 0 && Math.abs(sampleMs - this.offsetMs) > 2000) {
      this.offsetSamples = []; // the local clock was stepped; old samples are meaningless
    }
    this.offsetSamples.push(sampleMs);
    if (this.offsetSamples.length > 6) this.offsetSamples.shift();
    this.offsetMs = Math.max(...this.offsetSamples);
  }

  /** `key` identifies the on-air item (channel + set); a new key restarts the estimate. */
  public observe(key: string, positionSec: number, serverMs: number): void {
    if (!Number.isFinite(positionSec) || !Number.isFinite(serverMs)) return;
    const lower = serverMs - (positionSec + 1) * 1000;
    const upper = serverMs - positionSec * 1000;

    if (key !== this.key) {
      this.key = key;
      this.lo = lower;
      this.hi = upper;
      this.hasFix = true;
      return;
    }

    const nextLo = Math.max(this.lo, lower);
    const nextHi = Math.min(this.hi, upper);
    if (nextLo > nextHi) {
      // Inconsistent with earlier data (set restarted, server clock step): start over.
      this.lo = lower;
      this.hi = upper;
    } else {
      this.lo = nextLo;
      this.hi = nextHi;
    }
    this.hasFix = true;
  }

  public hasEstimate(): boolean {
    return this.hasFix;
  }

  /** Current on-air position in seconds from the start of the set. */
  public getTargetSec(): number {
    if (!this.hasFix) return 0;
    const startMs = (this.lo + this.hi) / 2;
    const serverNow = Date.now() + this.offsetMs;
    return Math.max(0, (serverNow - startMs) / 1000);
  }
}

interface PhaseLockHost {
  getAudio(): HTMLAudioElement | null;
  getTargetSec(): number;
  getDurationSec(): number;
  onChange(snapshot: SyncSnapshot): void;
}

export class LivePhaseLock {
  private timer: number | null = null;
  private smoothDrift: number | null = null;
  private compensating = false;
  private resyncing = false;
  private holdUntilMs = 0;
  private lastResyncAtMs = 0;
  private lastPublished: SyncSnapshot | null = null;

  constructor(private readonly host: PhaseLockHost) {}

  public start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(this.tick, PHASE_LOCK.TICK_MS);
  }

  public stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const audio = this.host.getAudio();
    if (audio) this.setRate(audio, 1, true);
    this.reset();
  }

  /** Forget measured drift (channel switch, pause, fresh load). */
  public reset(): void {
    this.smoothDrift = null;
    this.compensating = false;
    this.holdUntilMs = 0;
  }

  /** Runs a check immediately instead of waiting for the next tick (after wake-up, etc.). */
  public checkNow(): void {
    this.tick();
  }

  /** Jumps to the live point right away (manual LIVE SYNC, lock-screen seek). Bypasses the cooldown. */
  public forceResync(): Promise<void> {
    return this.resync(true);
  }

  private clampTarget(audio: HTMLAudioElement, targetSec: number): number {
    const metaDuration =
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
    const duration = Math.min(this.host.getDurationSec(), metaDuration);
    return Math.max(0, Math.min(targetSec, duration - 0.5));
  }

  private tick = (): void => {
    const audio = this.host.getAudio();
    if (!audio) {
      this.publish('idle', 0, 1);
      return;
    }

    // Let the media pipeline play at its normal rate while iOS throttles page timers.
    if (document.hidden) {
      this.reset();
      this.setRate(audio, 1, true);
      return;
    }

    if (this.resyncing || Date.now() < this.holdUntilMs) {
      this.publish('resync', this.smoothDrift ?? 0, audio.playbackRate);
      return;
    }

    const playing = !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 3;
    if (!playing) {
      this.reset();
      this.setRate(audio, 1, true);
      this.publish('idle', 0, audio.playbackRate);
      return;
    }

    const target = this.clampTarget(audio, this.host.getTargetSec());
    const rawDrift = audio.currentTime - target;
    this.smoothDrift =
      this.smoothDrift === null ? rawDrift : this.smoothDrift + (rawDrift - this.smoothDrift) * 0.5;

    const plan = planPhaseCorrection(this.smoothDrift, this.compensating);
    this.compensating = plan.compensating;

    if (plan.action === 'seek') {
      void this.resync(false);
      return;
    }

    this.setRate(audio, plan.targetRate, false);
    this.publish(
      plan.compensating ? 'compensating' : 'in-sync',
      this.smoothDrift,
      audio.playbackRate
    );
  };

  private async resync(force: boolean): Promise<void> {
    const audio = this.host.getAudio();
    if (!audio || this.resyncing) return;
    const now = Date.now();
    if (!force && now - this.lastResyncAtMs < PHASE_LOCK.RESYNC_COOLDOWN_MS) return;

    this.resyncing = true;
    this.lastResyncAtMs = now;
    this.publish('resync', this.smoothDrift ?? 0, audio.playbackRate);
    this.setRate(audio, 1, true);

    try {
      await radioDsp.seekWithMicroFade(audio, () =>
        this.clampTarget(audio, this.host.getTargetSec())
      );
    } finally {
      this.resyncing = false;
      this.smoothDrift = null;
      this.compensating = false;
      this.holdUntilMs = Date.now() + PHASE_LOCK.RESYNC_HOLD_MS;
    }
  }

  private setRate(audio: HTMLAudioElement, target: number, immediate: boolean): void {
    const current = audio.playbackRate;
    let next = target;
    if (!immediate) {
      const delta = target - current;
      const slew = PHASE_LOCK.RATE_SLEW_PER_TICK;
      next = current + Math.max(-slew, Math.min(slew, delta));
    }
    if (Math.abs(next - 1) < 0.0005) next = 1;
    if (Math.abs(next - current) < 1e-6) return;

    // Time-stretch instead of pitch-shift for the ±1.5 % nudge (Safari still needs the prefixed flag).
    audio.preservesPitch = true;
    (audio as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
    audio.playbackRate = next;
  }

  /** Notifies the UI only when something visible changed (state or drift at 0.1 s resolution). */
  private publish(state: SyncState, driftSec: number, playbackRate: number): void {
    const rounded = Math.round(Math.abs(driftSec) * 10) / 10;
    const prev = this.lastPublished;
    if (prev && prev.state === state && Math.round(Math.abs(prev.driftSec) * 10) / 10 === rounded) {
      return;
    }
    this.lastPublished = { state, driftSec, playbackRate };
    this.host.onChange(this.lastPublished);
  }
}
