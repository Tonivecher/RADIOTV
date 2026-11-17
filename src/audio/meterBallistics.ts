/**
 * Analog-style meter ballistics shared by every level indicator in the UI.
 *
 * - Attack: first-order response with a 10 ms time constant (needle jumps up almost instantly).
 * - Decay: multiplicative 0.85 per 60 fps frame, rescaled by real frame time so the fall-off
 *   looks identical at 30, 60 or 120 Hz.
 * - Peak marker: latches the highest value, holds it for a moment, then falls with the same decay.
 */

export const METER_ATTACK_MS = 10;
export const METER_DECAY_PER_FRAME = 0.85;
export const METER_FRAME_MS = 1000 / 60;
export const PEAK_HOLD_MS = 450;
/** Bottom of the meter scale in dBFS. */
export const METER_FLOOR_DB = -42;

/** Maps a linear amplitude (0..1) to a 0..1 meter position on a dB scale. */
export function levelToUnit(linear: number): number {
  if (!(linear > 0)) return 0;
  const db = 20 * Math.log10(linear);
  return Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

export class MeterBallistics {
  public level = 0;
  public peak = 0;
  private holdUntilMs = 0;

  public update(input: number, nowMs: number, dtMs: number): void {
    const dt = Math.max(0, Math.min(100, dtMs));
    const decay = Math.pow(METER_DECAY_PER_FRAME, dt / METER_FRAME_MS);

    if (input > this.level) {
      const attack = 1 - Math.exp(-dt / METER_ATTACK_MS);
      this.level += (input - this.level) * attack;
    } else {
      this.level = Math.max(input, this.level * decay);
    }
    if (this.level < 0.001) this.level = 0;

    if (input >= this.peak) {
      this.peak = input;
      this.holdUntilMs = nowMs + PEAK_HOLD_MS;
    } else if (nowMs > this.holdUntilMs) {
      this.peak = Math.max(this.level, this.peak * decay);
    }
    if (this.peak < 0.001) this.peak = 0;
  }

  public isAtRest(): boolean {
    return this.level === 0 && this.peak === 0;
  }

  public reset(): void {
    this.level = 0;
    this.peak = 0;
    this.holdUntilMs = 0;
  }
}
