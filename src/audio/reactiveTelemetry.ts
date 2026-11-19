import { radioDsp } from './dspEngine';
import { resolveChannelAsciiProfile } from '../constants/ascii';

interface ReactiveSnapshot {
  isPlaying: boolean;
  channelId: string;
  positionSec: number;
  durationSec: number;
  peaks: number[];
}

const state: ReactiveSnapshot = {
  isPlaying: false,
  channelId: 'ch-main',
  positionSec: 0,
  durationSec: 0,
  peaks: [],
};

export function updateReactiveAudioState(patch: Partial<ReactiveSnapshot>): void {
  if (patch.isPlaying !== undefined) state.isPlaying = patch.isPlaying;
  if (patch.channelId !== undefined) state.channelId = patch.channelId;
  if (patch.positionSec !== undefined) state.positionSec = patch.positionSec;
  if (patch.durationSec !== undefined) state.durationSec = patch.durationSec;
  if (patch.peaks !== undefined) state.peaks = patch.peaks;
}

/**
 * Returns a normalized 0..1 musical energy level for reactive visuals.
 * Uses real Web Audio stereo RMS when DSP is running, and derives smooth energy from
 * the broadcast set's actual waveform peaks when playing through the clean native <audio> path
 * (preserving iOS Lock Screen background audio without attaching createMediaElementSource).
 */
export function getReactiveAudioEnergy(nowSec: number): {
  level: number;
  left: number;
  right: number;
  isPlaying: boolean;
} {
  if (!state.isPlaying) {
    return { level: 0, left: 0, right: 0, isPlaying: false };
  }

  const realLevels = radioDsp.getStereoLevels();
  if (realLevels) {
    const left = Math.min(1, realLevels.rmsL * 2.6);
    const right = Math.min(1, realLevels.rmsR * 2.6);
    return {
      level: Math.max(left, right),
      left,
      right,
      isPlaying: true,
    };
  }

  const profile = resolveChannelAsciiProfile(state.channelId);
  const ratio =
    state.durationSec > 0
      ? Math.max(0, Math.min(0.999, state.positionSec / state.durationSec))
      : 0;
  const peakBase =
    state.peaks.length > 0
      ? state.peaks[Math.min(state.peaks.length - 1, Math.floor(ratio * state.peaks.length))] || 0.45
      : 0.45;

  const beatHz = profile.grooveBpm / 60;
  const kick = Math.pow(0.5 + 0.5 * Math.sin(nowSec * beatHz * Math.PI * 2), 2.2);
  const shimmer = 0.5 + 0.5 * Math.sin(nowSec * beatHz * Math.PI * 1.5 + 0.9);
  const sway = Math.sin(nowSec * 1.7) * 0.06;
  const base = Math.max(0.14, Math.min(0.92, peakBase * (0.58 + kick * 0.34 + shimmer * 0.12)));

  return {
    level: base,
    left: Math.max(0.08, Math.min(0.96, base + sway)),
    right: Math.max(0.08, Math.min(0.96, base - sway)),
    isPlaying: true,
  };
}

/**
 * Generates 32-bin spectrum values for the DSP console canvas.
 * Prefers real Web Audio FFT bins when DSP is active; falls back to a smooth
 * peak-modulated groove contour during direct native playback.
 */
export function getReactiveSpectrumBins(nowSec: number, isPlaying: boolean): number[] {
  if (!isPlaying) {
    return new Array<number>(32).fill(0);
  }
  const telemetry = radioDsp.getSpectrumAndMeters(true);
  if (telemetry.bins.some((v) => v > 0.01)) {
    return telemetry.bins;
  }

  const { level } = getReactiveAudioEnergy(nowSec);
  const bins = new Array<number>(32);
  for (let i = 0; i < 32; i++) {
    const t = i / 31;
    const tilt = Math.pow(1 - t * 0.72, 1.35);
    const wave =
      0.55 +
      0.28 * Math.sin(nowSec * 5.2 + i * 0.55) +
      0.17 * Math.cos(nowSec * 8.4 - i * 0.9);
    bins[i] = Math.max(0.04, Math.min(0.95, level * tilt * wave));
  }
  return bins;
}
