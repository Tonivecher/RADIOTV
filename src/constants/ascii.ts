export interface AsciiChannelProfile {
  bgColor: string;
  shadowHex: string;
  tintHex: string;
  highlightHex: string;
  accentGlowHex: string;
  duotoneMix: number;
  asciiMix: number;
  bgOpacity: number;
  bgBlur: number;
  cellSize: number;
  glitchIntensity: number;
  glyphAccent: number;
  bloomIntensity: number;
  vignetteIntensity: number;
  /** Genre tempo (BPM) driving subtle half-time spatial dot & corona breathing. */
  grooveBpm: number;
}

export interface AsciiPipelineConfig {
  renderMode: 'dots';
  bgMode: 'solid';
  bgBlur: number;
  bgOpacity: number;
  cellSize: number;
  coverage: number;
  invert: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  tintOpacity: number;
  overlayBlend: 'overlay';
  vignetteEnabled: boolean;
  vignetteIntensity: number;
  bloomEnabled: boolean;
  bloomIntensity: number;
  animated: boolean;
  animStyle: 'pulse';
  animSpeed: number;
  animIntensity: number;
}

export interface ChannelPortalCopy {
  eyebrow: string;
  title: string;
  tagline: string;
  skipLabel: string;
  accentHex: string;
  secondaryHex: string;
  bgHex: string;
  textHex: string;
}

/**
 * Baseline "Sunset" ASCII-dots pipeline parameters, adapted per genre channel.
 */
export const ASCII_DOTS_CONFIG: AsciiPipelineConfig = {
  renderMode: 'dots',
  bgMode: 'solid',
  bgBlur: 12,
  bgOpacity: 90,
  cellSize: 10,
  coverage: 100,
  invert: false,
  brightness: 0,
  contrast: 115,
  saturation: 100,
  grayscale: 0,
  tintOpacity: 32,
  overlayBlend: 'overlay',
  vignetteEnabled: true,
  vignetteIntensity: 55,
  bloomEnabled: true,
  bloomIntensity: 45,
  animated: true,
  animStyle: 'pulse',
  animSpeed: 100,
  animIntensity: 60,
};

export const ASCII_CHANNEL_PROFILES: Record<string, AsciiChannelProfile> = {
  'ch-main': {
    bgColor: '#1a1612',
    shadowHex: '#231a12',
    tintHex: '#e7bb94',
    highlightHex: '#f0e2cb',
    accentGlowHex: '#e7bb94',
    duotoneMix: 0.14,
    asciiMix: 0.36,
    bgOpacity: 10,
    bgBlur: 0,
    cellSize: 15,
    glitchIntensity: 0.18,
    glyphAccent: 0.92,
    bloomIntensity: 16,
    vignetteIntensity: 32,
    grooveBpm: 122,
  },
  'ch-deep': {
    bgColor: '#1a080d',
    shadowHex: '#280c13',
    tintHex: '#c84852',
    highlightHex: '#f0a69b',
    accentGlowHex: '#df8078',
    duotoneMix: 0.62,
    asciiMix: 0.62,
    bgOpacity: 22,
    bgBlur: 0,
    cellSize: 14,
    glitchIntensity: 0.22,
    glyphAccent: 0.96,
    bloomIntensity: 20,
    vignetteIntensity: 44,
    grooveBpm: 116,
  },
  'ch-afterglow': {
    bgColor: '#120d1f',
    shadowHex: '#1c1434',
    tintHex: '#8468d6',
    highlightHex: '#d0bef8',
    accentGlowHex: '#b19ce8',
    duotoneMix: 0.6,
    asciiMix: 0.66,
    bgOpacity: 24,
    bgBlur: 0,
    cellSize: 13,
    glitchIntensity: 0.24,
    glyphAccent: 1.0,
    bloomIntensity: 22,
    vignetteIntensity: 44,
    grooveBpm: 124,
  },
};

const CHANNEL_PORTAL_COPY: Record<string, ChannelPortalCopy> = {
  'ch-main': {
    eyebrow: '01 · ОСНОВНОЙ',
    title: 'ОСНОВНОЙ',
    tagline: 'Deep-tech и tech. Ровный ход.',
    skipLabel: 'Основной',
    accentHex: '#e7bb94',
    secondaryHex: '#b8c6ad',
    bgHex: '#1a1612',
    textHex: '#e4d8c4',
  },
  'ch-deep': {
    eyebrow: '02 · DEEP',
    title: 'DEEP',
    tagline: 'Deep и мягкий низ. Без суеты.',
    skipLabel: 'Deep',
    accentHex: '#df8078',
    secondaryHex: '#e4b493',
    bgHex: '#160a0d',
    textHex: '#e3d2cc',
  },
  'ch-afterglow': {
    eyebrow: '03 · DEEP TECH',
    title: 'DEEP TECH',
    tagline: 'Поздний deep tech. Темнее и плотнее.',
    skipLabel: 'DeepTech',
    accentHex: '#b19ce8',
    secondaryHex: '#e2b895',
    bgHex: '#14101d',
    textHex: '#dcd3eb',
  },
};

export type RadioThemeId = 'dusk' | 'deep' | 'afterglow';

export function resolveChannelAsciiProfile(channelId: string): AsciiChannelProfile {
  return ASCII_CHANNEL_PROFILES[channelId] || ASCII_CHANNEL_PROFILES['ch-main'];
}

export function resolveChannelPortalCopy(channelId: string): ChannelPortalCopy {
  return CHANNEL_PORTAL_COPY[channelId] || CHANNEL_PORTAL_COPY['ch-main'];
}

export function resolveThemeForChannel(channelId: string): RadioThemeId {
  if (channelId === 'ch-deep') return 'deep';
  if (channelId === 'ch-afterglow') return 'afterglow';
  return 'dusk';
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function parseHexTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean;
  const parsed = Number.parseInt(full, 16);
  if (!Number.isFinite(parsed)) {
    return [231, 187, 148];
  }
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function toHexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}

function lerpHex(fromHex: string, toHex: string, t: number): string {
  const [r1, g1, b1] = parseHexTuple(fromHex);
  const [r2, g2, b2] = parseHexTuple(toHex);
  return `#${toHexByte(lerp(r1, r2, t))}${toHexByte(lerp(g1, g2, t))}${toHexByte(lerp(b1, b2, t))}`;
}

/**
 * Smoothly morphs one genre visual profile into another across a scrub [0..1],
 * peaking glitch and glyph scintillation near the midpoint of the portal dive.
 */
export function interpolateAsciiProfile(
  from: AsciiChannelProfile,
  to: AsciiChannelProfile,
  rawProgress: number,
  portalSurge = 0.44
): AsciiChannelProfile {
  const p = clamp01(rawProgress);
  const eased = p * p * (3 - 2 * p);
  const surge = Math.sin(p * Math.PI);

  return {
    bgColor: lerpHex(from.bgColor, to.bgColor, eased),
    shadowHex: lerpHex(from.shadowHex, to.shadowHex, eased),
    tintHex: lerpHex(from.tintHex, to.tintHex, eased),
    highlightHex: lerpHex(from.highlightHex, to.highlightHex, eased),
    accentGlowHex: lerpHex(from.accentGlowHex, to.accentGlowHex, eased),
    duotoneMix: lerp(from.duotoneMix, to.duotoneMix, eased),
    asciiMix: lerp(from.asciiMix, to.asciiMix, eased),
    bgOpacity: lerp(from.bgOpacity, to.bgOpacity, eased),
    bgBlur: lerp(from.bgBlur, to.bgBlur, eased),
    cellSize: Math.max(8, Math.round(lerp(from.cellSize, to.cellSize, eased))),
    glitchIntensity: clamp01(lerp(from.glitchIntensity, to.glitchIntensity, eased) + surge * portalSurge),
    glyphAccent: clamp01(lerp(from.glyphAccent, to.glyphAccent, eased) + surge * 0.34),
    bloomIntensity: lerp(from.bloomIntensity, to.bloomIntensity, eased) + surge * 10,
    vignetteIntensity: lerp(from.vignetteIntensity, to.vignetteIntensity, eased),
    grooveBpm: lerp(from.grooveBpm, to.grooveBpm, eased),
  };
}
