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
    highlightHex: '#dfd3c0',
    accentGlowHex: '#e7bb94',
    duotoneMix: 0.08,
    asciiMix: 0.06,
    bgOpacity: 5,
    bgBlur: 0,
    cellSize: 10,
    glitchIntensity: 0.18,
    glyphAccent: 0.52,
    bloomIntensity: 10,
    vignetteIntensity: 32,
    grooveBpm: 122,
  },
  'ch-deep': {
    bgColor: '#05070d',
    shadowHex: '#07132b',
    tintHex: '#2f9fd6',
    highlightHex: '#68a6d8',
    accentGlowHex: '#38bdf8',
    duotoneMix: 0.94,
    asciiMix: 1.0,
    bgOpacity: 92,
    bgBlur: 12,
    cellSize: 10,
    glitchIntensity: 0.05,
    glyphAccent: 0.08,
    bloomIntensity: 12,
    vignetteIntensity: 58,
    grooveBpm: 116,
  },
  'ch-afterglow': {
    bgColor: '#14101d',
    shadowHex: '#1f1638',
    tintHex: '#8b6fd9',
    highlightHex: '#a38ad9',
    accentGlowHex: '#a78bfa',
    duotoneMix: 0.9,
    asciiMix: 1.0,
    bgOpacity: 92,
    bgBlur: 11,
    cellSize: 9,
    glitchIntensity: 0.24,
    glyphAccent: 0.28,
    bloomIntensity: 12,
    vignetteIntensity: 58,
    grooveBpm: 124,
  },
};

const CHANNEL_PORTAL_COPY: Record<string, ChannelPortalCopy> = {
  'ch-main': {
    eyebrow: 'КАНАЛ 01 · ОСНОВНОЙ ЭФИР',
    title: 'ОСНОВНОЙ',
    tagline: 'Deep-tech и tech. Ровный ритм городского вечера.',
    skipLabel: 'Войти в Основной',
    accentHex: '#e7bb94',
    secondaryHex: '#c3d5b5',
    bgHex: '#1a1612',
    textHex: '#eae0cf',
  },
  'ch-deep': {
    eyebrow: 'КАНАЛ 02 · ГЛУБОКИЙ ЭФИР',
    title: 'DEEP',
    tagline: 'Глубже в звук. Deep и мягкий бас.',
    skipLabel: 'Войти в Deep',
    accentHex: '#38bdf8',
    secondaryHex: '#818cf8',
    bgHex: '#05070d',
    textHex: '#d4e3f2',
  },
  'ch-afterglow': {
    eyebrow: 'КАНАЛ 03 · DEEP TECH',
    title: 'DEEP TECH',
    tagline: 'Медленнее, теплее. Глубокий ночной ритм.',
    skipLabel: 'Войти в DeepTech',
    accentHex: '#a78bfa',
    secondaryHex: '#e7bb94',
    bgHex: '#14101d',
    textHex: '#dcd3ee',
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
