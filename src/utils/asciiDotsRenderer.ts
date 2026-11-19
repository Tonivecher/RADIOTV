import {
  ASCII_DOTS_CONFIG,
  AsciiChannelProfile,
  AsciiPipelineConfig,
} from '../constants/ascii';
import { renderAsciiGlobeLayer } from './asciiGlobe';

export type AsciiMediaSource = HTMLVideoElement | HTMLImageElement;

export interface AsciiRenderOptions {
  width: number;
  height: number;
  dpr: number;
  overscanTopPx?: number;
  timeSec: number;
  profile: AsciiChannelProfile;
  animate: boolean;
  scale?: number;
  /** Keep glitch modulation continuous rather than burst-gated (used during channel transfer). */
  continuousGlitch?: boolean;
  /** Normalized 0..1 live audio energy driving organic pulse & scintillation. */
  audioLevel?: number;
  /** Normalized 0..1 pointer position for idle flow-field shimmer. */
  pointerX?: number;
  pointerY?: number;
  /** 0..1 surge intensity for instant RGB/ASCII channel transfer burst. */
  transferSurge?: number;
}

const TAU = Math.PI * 2;
const QUANT_SHIFT = 4;
const MATRIX_CHARS = '·:;=+*#%@012345789∆∇◊░▒▓';
const GLITCH_STRIPS = ['01 // ∆◊', '░▒▓ :: 79', '∆ 104.2 // ░', '▓▒░ + #01'];

interface ColorLuts {
  key: string;
  duotoneMix: number;
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  rampR: Uint8Array;
  rampG: Uint8Array;
  rampB: Uint8Array;
}

interface CoverRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface GlyphPoint {
  x: number;
  y: number;
  char: string;
  colorKey: number;
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function clampByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

function pseudoRand(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function parseHexColor(hex: string): [number, number, number] {
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

function overlayChannel(base: number, tint: number): number {
  return base < 128
    ? (2 * base * tint) / 255
    : 255 - (2 * (255 - base) * (255 - tint)) / 255;
}

function buildChannelLut(
  tintChannel: number,
  contrastFactor: number,
  tintAlpha: number
): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const contrasted = Math.max(0, Math.min(255, (i - 128) * contrastFactor + 128));
    const blended =
      contrasted * (1 - tintAlpha) + overlayChannel(contrasted, tintChannel) * tintAlpha;
    lut[i] = clampByte(blended);
  }
  return lut;
}

function buildToneRamp(
  shadowHex: string,
  midHex: string,
  highlightHex: string,
  contrastFactor: number
): { rampR: Uint8Array; rampG: Uint8Array; rampB: Uint8Array } {
  const [sr, sg, sb] = parseHexColor(shadowHex);
  const [mr, mg, mb] = parseHexColor(midHex);
  const [hr, hg, hb] = parseHexColor(highlightHex);
  const rampR = new Uint8Array(256);
  const rampG = new Uint8Array(256);
  const rampB = new Uint8Array(256);

  for (let i = 0; i < 256; i++) {
    const contrasted = Math.max(0, Math.min(255, (i - 128) * contrastFactor + 128));
    if (contrasted <= 145) {
      const t = contrasted / 145;
      rampR[i] = clampByte(sr + (mr - sr) * t);
      rampG[i] = clampByte(sg + (mg - sg) * t);
      rampB[i] = clampByte(sb + (mb - sb) * t);
    } else {
      const t = (contrasted - 145) / 110;
      rampR[i] = clampByte(mr + (hr - mr) * t);
      rampG[i] = clampByte(mg + (hg - mg) * t);
      rampB[i] = clampByte(mb + (hb - mb) * t);
    }
  }
  return { rampR, rampG, rampB };
}

function computeCoverRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  scale = 1
): CoverRect {
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  let baseW = srcW;
  let baseH = srcH;
  if (srcAspect > dstAspect) {
    baseW = srcH * dstAspect;
  } else {
    baseH = srcW / dstAspect;
  }
  const safeScale = Math.max(1, scale);
  const sw = baseW / safeScale;
  const sh = baseH / safeScale;
  return {
    sx: (srcW - sw) * 0.5,
    sy: (srcH - sh) * 0.5,
    sw,
    sh,
  };
}

function getSourceDimensions(
  source: AsciiMediaSource
): { width: number; height: number } | null {
  if (source instanceof HTMLVideoElement) {
    if (
      source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !source.videoWidth ||
      !source.videoHeight
    ) {
      return null;
    }
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (!source.complete || !source.naturalWidth || !source.naturalHeight) {
    return null;
  }
  return { width: source.naturalWidth, height: source.naturalHeight };
}

/**
 * Reusable Canvas2D renderer supporting both crisp video with delicate ASCII glitch
 * (`asciiMix` ~ 0.15 on Main) and full Sunset "dots" ASCII modes (`asciiMix` = 1 on Deep/DeepTech),
 * plus seamless continuous morphing between any two genre profiles.
 */
export class AsciiDotsRenderer {
  private readonly config: AsciiPipelineConfig;
  private readonly sampleCanvas: HTMLCanvasElement;
  private readonly sampleCtx: CanvasRenderingContext2D;
  private readonly blurCanvas: HTMLCanvasElement;
  private readonly blurCtx: CanvasRenderingContext2D;
  private readonly dotsCanvas: HTMLCanvasElement;
  private readonly dotsCtx: CanvasRenderingContext2D;
  private readonly bloomCanvasA: HTMLCanvasElement;
  private readonly bloomCtxA: CanvasRenderingContext2D;
  private readonly bloomCanvasB: HTMLCanvasElement;
  private readonly bloomCtxB: CanvasRenderingContext2D;

  private luts: ColorLuts | null = null;
  private vignetteGradient: CanvasGradient | null = null;
  private vignetteKey = '';
  private readonly colorLabels = new Map<number, string>();
  private readonly buckets = new Map<number, number[]>();
  private readonly glyphQueue: GlyphPoint[] = [];

  constructor(config: AsciiPipelineConfig = ASCII_DOTS_CONFIG) {
    this.config = config;
    this.sampleCanvas = document.createElement('canvas');
    this.blurCanvas = document.createElement('canvas');
    this.dotsCanvas = document.createElement('canvas');
    this.bloomCanvasA = document.createElement('canvas');
    this.bloomCanvasB = document.createElement('canvas');

    const sampleCtx = this.sampleCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    const blurCtx = this.blurCanvas.getContext('2d');
    const dotsCtx = this.dotsCanvas.getContext('2d');
    const bloomCtxA = this.bloomCanvasA.getContext('2d');
    const bloomCtxB = this.bloomCanvasB.getContext('2d');

    if (!sampleCtx || !blurCtx || !dotsCtx || !bloomCtxA || !bloomCtxB) {
      throw new Error('2D canvas context unavailable for ASCII renderer');
    }

    this.sampleCtx = sampleCtx;
    this.blurCtx = blurCtx;
    this.dotsCtx = dotsCtx;
    this.bloomCtxA = bloomCtxA;
    this.bloomCtxB = bloomCtxB;
  }

  private ensureLuts(profile: AsciiChannelProfile): ColorLuts {
    const contrast = this.config.contrast / 100;
    const tintOpacity = this.config.tintOpacity / 100;
    const mixRounded = profile.duotoneMix.toFixed(3);
    const key = `${profile.shadowHex}|${profile.tintHex}|${profile.highlightHex}|${mixRounded}|${contrast}|${tintOpacity}`;
    if (this.luts && this.luts.key === key) {
      return this.luts;
    }
    const [tr, tg, tb] = parseHexColor(profile.tintHex);
    const ramp = buildToneRamp(profile.shadowHex, profile.tintHex, profile.highlightHex, contrast);
    this.luts = {
      key,
      duotoneMix: profile.duotoneMix,
      r: buildChannelLut(tr, contrast, tintOpacity),
      g: buildChannelLut(tg, contrast, tintOpacity),
      b: buildChannelLut(tb, contrast, tintOpacity),
      rampR: ramp.rampR,
      rampG: ramp.rampG,
      rampB: ramp.rampB,
    };
    return this.luts;
  }

  private getColorString(key: number): string {
    let label = this.colorLabels.get(key);
    if (!label) {
      const r = Math.min(232, ((key >> 8) & 15) * 16 + 8);
      const g = Math.min(232, ((key >> 4) & 15) * 16 + 8);
      const b = Math.min(232, (key & 15) * 16 + 8);
      label = `rgb(${r},${g},${b})`;
      this.colorLabels.set(key, label);
    }
    return label;
  }

  private ensureVignette(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    intensity: number
  ): CanvasGradient {
    const key = `${width}x${height}:${intensity.toFixed(1)}`;
    if (this.vignetteGradient && this.vignetteKey === key) {
      return this.vignetteGradient;
    }
    const cx = width * 0.5;
    const cy = height * 0.5;
    const outerRadius = Math.hypot(cx, cy);
    const grad = ctx.createRadialGradient(cx, cy, outerRadius * 0.28, cx, cy, outerRadius);
    const alpha = Math.max(0, Math.min(0.95, intensity / 100));
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.55, `rgba(0,0,0,${(alpha * 0.28).toFixed(3)})`);
    grad.addColorStop(1, `rgba(0,0,0,${alpha.toFixed(3)})`);
    this.vignetteGradient = grad;
    this.vignetteKey = key;
    return grad;
  }

  private drawSourceGlitchSlices(
    ctx: CanvasRenderingContext2D,
    source: AsciiMediaSource,
    crop: CoverRect,
    width: number,
    height: number,
    timeSec: number,
    strength: number,
    tintHex: string,
    drawGlyphStrip: boolean
  ): void {
    const tick = Math.floor(timeSec * 11);
    const bandCount = Math.max(2, Math.round(2 + strength * 4));
    ctx.save();

    for (let i = 0; i < bandCount; i++) {
      const seed = tick * 19 + i * 37;
      if (pseudoRand(seed + 1) > 0.35 + strength * 0.65) continue;

      const bandYFrac = pseudoRand(seed + 2) * 0.88 + 0.04;
      const bandHFrac = (0.004 + pseudoRand(seed + 3) * 0.014) * (0.65 + strength);
      const dstY = bandYFrac * height;
      const dstH = Math.max(2, bandHFrac * height);
      const srcY = crop.sy + bandYFrac * crop.sh;
      const srcH = Math.max(1, bandHFrac * crop.sh);
      const shiftX = (pseudoRand(seed + 4) - 0.5) * 2 * (6 + strength * 26);

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(0.55, 0.22 + strength * 0.34);
      ctx.drawImage(source, crop.sx, srcY, crop.sw, srcH, shiftX, dstY, width, dstH);

      // Hairline tinted echo for subtle chromatic ASCII hint
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(0.28, 0.08 + strength * 0.22);
      ctx.fillStyle = tintHex;
      ctx.fillRect(shiftX > 0 ? 0 : width * 0.15, dstY, width * 0.85, 1);

      if (drawGlyphStrip && i === 0 && pseudoRand(seed + 9) > 0.35) {
        const text = GLITCH_STRIPS[Math.floor(pseudoRand(seed + 11) * GLITCH_STRIPS.length)];
        const textX = width * (0.12 + pseudoRand(seed + 13) * 0.72);
        ctx.font = '600 10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.globalAlpha = Math.min(0.42, 0.16 + strength * 0.35);
        ctx.fillText(text, textX, Math.max(14, dstY - 2));
      }
    }

    ctx.restore();
  }

  private drawDotsGlitchSlices(
    ctx: CanvasRenderingContext2D,
    dpr: number,
    width: number,
    height: number,
    timeSec: number,
    strength: number,
    tintHex: string
  ): void {
    const tick = Math.floor(timeSec * 14);
    const bandCount = Math.max(2, Math.round(2 + strength * 5));
    const pixelW = this.dotsCanvas.width;
    const pixelH = this.dotsCanvas.height;
    if (!pixelW || !pixelH) return;

    ctx.save();
    for (let i = 0; i < bandCount; i++) {
      const seed = tick * 23 + i * 41;
      if (pseudoRand(seed + 2) > 0.3 + strength * 0.7) continue;

      const yFrac = pseudoRand(seed + 3) * 0.9 + 0.04;
      const hFrac = 0.005 + pseudoRand(seed + 5) * 0.018;
      const sy = Math.floor(yFrac * pixelH);
      const sh = Math.max(dpr, Math.round(hFrac * pixelH));
      const dy = yFrac * height;
      const dh = hFrac * height;
      const shiftX = (pseudoRand(seed + 7) - 0.5) * 2 * (8 + strength * 28);

      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(0.65, 0.2 + strength * 0.45);
      ctx.drawImage(this.dotsCanvas, 0, sy, pixelW, sh, shiftX, dy, width, dh);

      if (i < 2) {
        ctx.fillStyle = tintHex;
        ctx.globalAlpha = Math.min(0.24, 0.06 + strength * 0.2);
        ctx.fillRect(0, dy, width, 1);
      }
    }
    ctx.restore();
  }

  private drawTransferGlitchBurst(
    ctx: CanvasRenderingContext2D,
    source: AsciiMediaSource,
    crop: CoverRect,
    width: number,
    height: number,
    timeSec: number,
    surge: number,
    accentHex: string
  ): void {
    const tick = Math.floor(timeSec * 28);
    const bandCount = Math.max(5, Math.round(6 + surge * 10));
    const chromaColors = ['#ff385c', '#4de4f4', '#b19ce8', accentHex];

    ctx.save();
    for (let i = 0; i < bandCount; i++) {
      const seed = tick * 31 + i * 53;
      const yFrac = pseudoRand(seed + 1) * 0.94 + 0.02;
      const hFrac = (0.008 + pseudoRand(seed + 2) * 0.036) * (0.65 + surge * 0.8);
      const dstY = yFrac * height;
      const dstH = Math.max(3, hFrac * height);
      const srcY = crop.sy + yFrac * crop.sh;
      const srcH = Math.max(1, hFrac * crop.sh);
      const shiftX = (pseudoRand(seed + 3) - 0.5) * 2 * (18 + surge * 68);

      // Torn horizontal video strip shifted sideways
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(0.88, 0.35 + surge * 0.52);
      ctx.drawImage(source, crop.sx, srcY, crop.sw, srcH, shiftX, dstY, width, dstH);

      // Chromatic RGB / cyan / violet signal split along the tear edge
      const chroma = chromaColors[i % chromaColors.length];
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(0.55, 0.16 + surge * 0.42);
      ctx.fillStyle = chroma;
      ctx.fillRect(shiftX * 0.65, dstY, width, Math.max(1.5, dstH * 0.24));

      // ASCII signal burst characters along key bands
      if (i % 2 === 0) {
        const strip = GLITCH_STRIPS[Math.floor(pseudoRand(seed + 7) * GLITCH_STRIPS.length)];
        const tx = width * (0.06 + pseudoRand(seed + 11) * 0.84);
        ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = Math.min(0.75, 0.24 + surge * 0.55);
        ctx.fillStyle = i % 4 === 0 ? '#4de4f4' : accentHex;
        ctx.fillText(`${strip} // ░+`, tx, dstY + dstH * 0.5);
      }
    }
    ctx.restore();
  }

  renderFrame(
    targetCanvas: HTMLCanvasElement,
    source: AsciiMediaSource | null,
    options: AsciiRenderOptions
  ): boolean {
    const width = Math.max(1, Math.round(options.width));
    const height = Math.max(1, Math.round(options.height));
    const dpr = Math.max(1, Math.min(2, options.dpr || 1));
    const pixelW = Math.round(width * dpr);
    const pixelH = Math.round(height * dpr);
    const { profile } = options;
    const audioLevel = clamp01(options.audioLevel ?? 0);
    const transferSurge = clamp01(options.transferSurge ?? 0);
    const ptrX = options.pointerX ?? 0.5;
    const ptrY = options.pointerY ?? 0.5;

    if (targetCanvas.width !== pixelW || targetCanvas.height !== pixelH) {
      targetCanvas.width = pixelW;
      targetCanvas.height = pixelH;
    }

    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return false;

    const dims = source ? getSourceDimensions(source) : null;
    if (!source || !dims) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = profile.bgColor;
      ctx.fillRect(0, 0, width, height);
      return false;
    }

    const asciiMix = clamp01(profile.asciiMix);
    const cellSize = Math.max(8, Math.round(profile.cellSize));
    const cols = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    const crop = computeCoverRect(dims.width, dims.height, width, height, options.scale ?? 1);

    // Organic glitch envelope modulated by live audio peaks + rare spontaneous ripples.
    const animated = this.config.animated && options.animate;
    let effectiveGlitch = 0;
    if (animated && (profile.glitchIntensity > 0.01 || transferSurge > 0.01)) {
      if (options.continuousGlitch || transferSurge > 0.02) {
        effectiveGlitch = clamp01(profile.glitchIntensity + transferSurge * 0.72);
      } else {
        const wave =
          0.5 +
          0.28 * Math.sin(options.timeSec * 1.45) +
          0.22 * Math.sin(options.timeSec * 0.57 + 1.7);
        const burst = clamp01((wave - 0.62) / 0.32);
        const audioKick = Math.max(0, audioLevel - 0.55) * 0.65;
        effectiveGlitch = clamp01(profile.glitchIntensity * (0.2 + 0.8 * burst) + audioKick);
      }
    }

    // 1. Sample downsampled source for luminance + dot quantization
    if (this.sampleCanvas.width !== cols || this.sampleCanvas.height !== rows) {
      this.sampleCanvas.width = cols;
      this.sampleCanvas.height = rows;
    }
    this.sampleCtx.imageSmoothingEnabled = true;
    this.sampleCtx.imageSmoothingQuality = 'medium';
    this.sampleCtx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, cols, rows);
    const pixels = this.sampleCtx.getImageData(0, 0, cols, rows).data;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 2. ALWAYS render the live crisp video frame on ALL channels (Основной, Deep, DeepTech)
    ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);

    // Subtle atmospheric soften only if bgBlur >= 1 (kept very transparent so video remains clear)
    if (profile.bgBlur >= 0.8) {
      const blurScale = Math.max(3, Math.round(profile.bgBlur * 2.5));
      const blurW = Math.max(24, Math.round(width / blurScale));
      const blurH = Math.max(18, Math.round(height / blurScale));
      if (this.blurCanvas.width !== blurW || this.blurCanvas.height !== blurH) {
        this.blurCanvas.width = blurW;
        this.blurCanvas.height = blurH;
      }
      this.blurCtx.imageSmoothingEnabled = true;
      this.blurCtx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, blurW, blurH);
      ctx.globalAlpha = Math.min(0.14, profile.bgBlur * 0.06);
      ctx.drawImage(this.blurCanvas, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    // Channel mood color-grading tint over the live video (ruby for Deep, indigo-amethyst for DeepTech)
    if (profile.duotoneMix > 0.16) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = clamp01(profile.duotoneMix * 0.44);
      ctx.fillStyle = profile.tintHex;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = clamp01(profile.duotoneMix * 0.36);
      ctx.fillStyle = profile.tintHex;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // Light translucent atmospheric veil (never opaque: capped at <= 34% so live video always shines through)
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(0.34, clamp01(profile.bgOpacity / 100));
    ctx.fillStyle = profile.bgColor;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;

    if (effectiveGlitch > 0.03) {
      this.drawSourceGlitchSlices(
        ctx,
        source,
        crop,
        width,
        height,
        options.timeSec,
        effectiveGlitch * 0.85,
        profile.accentGlowHex,
        profile.glyphAccent > 0.2
      );
    }

    // 3. Render composite Matrix-style ASCII character grid + digital rain streams layered OVER the live video
    if (this.dotsCanvas.width !== pixelW || this.dotsCanvas.height !== pixelH) {
      this.dotsCanvas.width = pixelW;
      this.dotsCanvas.height = pixelH;
    }
    this.dotsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dotsCtx.clearRect(0, 0, width, height);

    const luts = this.ensureLuts(profile);
    this.buckets.forEach((arr) => {
      arr.length = 0;
    });
    this.glyphQueue.length = 0;

    const pulseDepth = (0.16 + audioLevel * 0.24) * (this.config.animIntensity / 100);
    const beatPhase = options.timeSec * (profile.grooveBpm / 120) * TAU;
    const beatSwell = animated ? Math.pow(0.5 + 0.5 * Math.sin(beatPhase), 1.5) : 0.5;
    const halfCols = cols * 0.5;
    const halfRows = rows * 0.5;
    const ptrCol = ptrX * cols;
    const ptrRow = ptrY * rows;
    const halfCell = cellSize * 0.5;
    const duotoneMix = luts.duotoneMix;
    const keepMix = 1 - duotoneMix;
    const lumThreshold = 0.30 * (1 - asciiMix) + 0.11 * asciiMix;
    const edgeGate = Math.max(0.012, (1 - asciiMix * 1.15) * 0.082);
    const flickerBucket = animated ? Math.floor(options.timeSec * (8 + audioLevel * 8)) : 0;
    const rainSpan = rows + 18;
    const rainSpeedScale = 1 + transferSurge * 2.4 + audioLevel * 0.45;
    const charCount = MATRIX_CHARS.length;

    for (let col = 0; col < cols; col++) {
      const cx = col * cellSize + halfCell;
      const dx = col - halfCols;
      // Per-column Matrix digital rain stream parameters
      const colSeed = pseudoRand(col * 19.73 + 7.13);
      const colActive = colSeed < 0.42 + asciiMix * 0.38 + transferSurge * 0.35;
      const colSpeed = (3.2 + pseudoRand(col * 37.19) * 5.8) * rainSpeedScale;
      const colPhase = pseudoRand(col * 71.41) * rainSpan;
      const rainHead = animated && colActive
        ? ((options.timeSec * colSpeed + colPhase) % rainSpan) - 6
        : -999;

      for (let row = 0; row < rows; row++) {
        const cy = row * cellSize + halfCell;
        const dy = row - halfRows;
        const rowOffset = row * cols;
        const idx = (rowOffset + col) * 4;
        const baseR = luts.r[pixels[idx]];
        const baseG = luts.g[pixels[idx + 1]];
        const baseB = luts.b[pixels[idx + 2]];
        const lumByte = (54 * baseR + 183 * baseG + 19 * baseB) >> 8;
        const lum = lumByte / 255;

        // Distance behind the falling Matrix stream head in this column
        const rainDist = rainHead - row;
        const inRainStream = animated && colActive && rainDist >= 0 && rainDist < 11;
        const isRainHead = inRainStream && rainDist < 1.35;
        const rainGain = inRainStream ? (1 - rainDist / 11) * (0.28 + asciiMix * 0.24) : 0;

        if (lum + rainGain < lumThreshold) continue;

        // Selective contour/silhouette + Matrix stream emphasis so live video remains recognizable underneath
        const rightIdx = col + 1 < cols ? (rowOffset + col + 1) * 4 : idx;
        const downIdx = row + 1 < rows ? ((row + 1) * cols + col) * 4 : idx;
        const neighborDiff =
          Math.max(
            Math.abs(pixels[idx + 1] - pixels[rightIdx + 1]),
            Math.abs(pixels[idx + 1] - pixels[downIdx + 1])
          ) / 255;

        const ptrDist = Math.hypot(col - ptrCol, row - ptrRow);
        const cursorLift = animated && ptrDist < 15 ? (1 - ptrDist / 15) * 0.28 : 0;
        const hashMatch =
          ((col * 19 + row * 37 + flickerBucket * 5) & 15) < (3 + Math.round(asciiMix * 9));

        if (
          !inRainStream &&
          neighborDiff < edgeGate &&
          lum + cursorLift < 0.52 - asciiMix * 0.2 &&
          !hashMatch
        ) {
          continue;
        }

        let r =
          duotoneMix > 0
            ? clampByte(baseR * keepMix + luts.rampR[lumByte] * duotoneMix)
            : baseR;
        let g =
          duotoneMix > 0
            ? clampByte(baseG * keepMix + luts.rampG[lumByte] * duotoneMix)
            : baseG;
        let b =
          duotoneMix > 0
            ? clampByte(baseB * keepMix + luts.rampB[lumByte] * duotoneMix)
            : baseB;

        if (isRainHead) {
          // Bright leading Matrix symbol head
          r = clampByte(r * 0.55 + 236 * 0.45);
          g = clampByte(g * 0.55 + 228 * 0.45);
          b = clampByte(b * 0.55 + 214 * 0.45);
        } else if (inRainStream) {
          const boost = 1 + rainGain * 0.65;
          r = clampByte(r * boost);
          g = clampByte(g * boost);
          b = clampByte(b * boost);
        }

        const key =
          ((r >> QUANT_SHIFT) << 8) |
          ((g >> QUANT_SHIFT) << 4) |
          (b >> QUANT_SHIFT);

        let effectiveEnergy = clamp01(
          lum * 0.85 + neighborDiff * 0.55 + rainGain * 0.8 + cursorLift * 0.65
        );
        if (animated) {
          const dist = Math.hypot(dx, dy);
          const wave = Math.sin(beatPhase - dist * 0.2 + col * 0.08);
          const groovePulse = Math.pow(0.5 + 0.5 * wave, 1.35) * 2 - 1;
          effectiveEnergy = clamp01(effectiveEnergy * (1 + pulseDepth * groovePulse));
        }

        let charIdx: number;
        if (isRainHead || (inRainStream && ((row + flickerBucket) & 3) === 0)) {
          // Mutating Matrix cyber-glyphs in active stream
          const streamHash = (col * 29 + row * 17 + flickerBucket * 13) & 31;
          charIdx = Math.min(
            charCount - 1,
            8 + (streamHash % Math.max(1, charCount - 8))
          );
        } else {
          // Contour & luminance-driven symbol selection with gentle shimmer
          const baseIdx = Math.floor(effectiveEnergy * (charCount - 1));
          const shimmer =
            animated && ((col * 11 + row * 23 + flickerBucket) & 15) === 0 ? 1 : 0;
          charIdx = Math.max(0, Math.min(charCount - 1, baseIdx + shimmer));
        }

        const jitterX =
          animated && (audioLevel > 0.38 || transferSurge > 0.1) && ((col + row + flickerBucket) & 7) === 0
            ? (pseudoRand(col * 13 + row * 7 + flickerBucket) - 0.5) *
              (2.2 * (audioLevel + transferSurge))
            : 0;

        let list = this.buckets.get(key);
        if (!list) {
          list = [];
          this.buckets.set(key, list);
        }
        list.push(cx + jitterX, cy, charIdx);
      }
    }

    const fontPx = Math.max(9, Math.round(cellSize * 0.96));
    this.dotsCtx.font = `700 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    this.dotsCtx.textAlign = 'center';
    this.dotsCtx.textBaseline = 'middle';

    for (const [key, coords] of this.buckets.entries()) {
      if (coords.length === 0) continue;
      this.dotsCtx.fillStyle = this.getColorString(key);
      for (let i = 0; i < coords.length; i += 3) {
        const gx = coords[i];
        const gy = coords[i + 1];
        const cIdx = coords[i + 2];
        this.dotsCtx.fillText(MATRIX_CHARS[cIdx] || '+', gx, gy);
      }
    }

    // 4. Composite luminous ASCII layer over live video via `screen` blend so video reads cleanly underneath
    const rhythmAlpha = animated ? 0.88 + 0.12 * beatSwell + audioLevel * 0.14 : 0.94;
    const baseDotsAlpha = 0.24 + asciiMix * 0.52;
    const dotsAlpha = clamp01(baseDotsAlpha * rhythmAlpha);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = dotsAlpha;
    ctx.drawImage(this.dotsCanvas, 0, 0, width, height);
    ctx.restore();

    if (effectiveGlitch > 0.04) {
      this.drawDotsGlitchSlices(
        ctx,
        dpr,
        width,
        height,
        options.timeSec,
        effectiveGlitch * (0.45 + asciiMix * 0.55),
        profile.accentGlowHex
      );
    }

    if (transferSurge > 0.02) {
      this.drawTransferGlitchBurst(
        ctx,
        source,
        crop,
        width,
        height,
        options.timeSec,
        transferSurge,
        profile.accentGlowHex
      );
    }

    // 5. 2-pass cross-browser bloom glow
    if (this.config.bloomEnabled && profile.bloomIntensity > 1) {
      const bloomW1 = Math.max(32, Math.round(width / 4));
      const bloomH1 = Math.max(24, Math.round(height / 4));
      const bloomW2 = Math.max(16, Math.round(width / 10));
      const bloomH2 = Math.max(12, Math.round(height / 10));

      if (this.bloomCanvasA.width !== bloomW1 || this.bloomCanvasA.height !== bloomH1) {
        this.bloomCanvasA.width = bloomW1;
        this.bloomCanvasA.height = bloomH1;
      }
      if (this.bloomCanvasB.width !== bloomW2 || this.bloomCanvasB.height !== bloomH2) {
        this.bloomCanvasB.width = bloomW2;
        this.bloomCanvasB.height = bloomH2;
      }

      this.bloomCtxA.clearRect(0, 0, bloomW1, bloomH1);
      this.bloomCtxA.imageSmoothingEnabled = true;
      this.bloomCtxA.drawImage(this.dotsCanvas, 0, 0, bloomW1, bloomH1);

      this.bloomCtxB.clearRect(0, 0, bloomW2, bloomH2);
      this.bloomCtxB.imageSmoothingEnabled = true;
      this.bloomCtxB.drawImage(this.bloomCanvasA, 0, 0, bloomW2, bloomH2);

      this.bloomCtxA.clearRect(0, 0, bloomW1, bloomH1);
      this.bloomCtxA.drawImage(this.bloomCanvasB, 0, 0, bloomW1, bloomH1);

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(
        0.72,
        (profile.bloomIntensity / 100) * 0.95 * dotsAlpha * (animated ? 0.88 + 0.24 * beatSwell + audioLevel * 0.16 : 1)
      );
      ctx.drawImage(this.bloomCanvasA, 0, 0, width, height);
      ctx.restore();
    }

    // 5b. Autonomous & interactive Ball-Lightning ASCII Globe roaming freely across the sky
    renderAsciiGlobeLayer(ctx, {
      width,
      height,
      overscanTopPx: options.overscanTopPx ?? 0,
      timeSec: options.timeSec,
      profile,
      pixels,
      sampleCols: cols,
      sampleRows: rows,
      scale: options.scale ?? 1,
      animate: animated,
      glitchStrength: effectiveGlitch,
      audioLevel,
      pointerX: ptrX,
      pointerY: ptrY,
    });

    // 6. Radial vignette
    if (this.config.vignetteEnabled && profile.vignetteIntensity > 1) {
      ctx.fillStyle = this.ensureVignette(ctx, width, height, profile.vignetteIntensity);
      ctx.fillRect(0, 0, width, height);
    }

    return true;
  }

  dispose(): void {
    this.sampleCanvas.width = 0;
    this.blurCanvas.width = 0;
    this.dotsCanvas.width = 0;
    this.bloomCanvasA.width = 0;
    this.bloomCanvasB.width = 0;
    this.buckets.clear();
    this.colorLabels.clear();
    this.glyphQueue.length = 0;
    this.vignetteGradient = null;
  }
}
