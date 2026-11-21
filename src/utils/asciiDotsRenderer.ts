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

const STREAM_CHARS = '012345789∆∇◊+:=·/';
const GLITCH_STRIPS = ['01 // ∆◊', '░▒▓ :: 79', '∆ 104.2 // ░', '▓▒░ + #01'];
const SAMPLE_INTERVAL_MS = 84;
const ATLAS_TONE_ROWS = 4;
const MATRIX_NEON_GREEN_HEX = '#39ff88';

interface CoverRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
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
  private readonly bloomCanvas: HTMLCanvasElement;
  private readonly bloomCtx: CanvasRenderingContext2D;
  private readonly atlasCanvas: HTMLCanvasElement;
  private readonly atlasCtx: CanvasRenderingContext2D;

  private atlasKey = '';
  private atlasSlot = 16;
  private vignetteGradient: CanvasGradient | null = null;
  private vignetteKey = '';

  private cachedPixels: Uint8ClampedArray | null = null;
  private cachedCols = 0;
  private cachedRows = 0;
  private lastSampleAt = -Infinity;

  constructor(config: AsciiPipelineConfig = ASCII_DOTS_CONFIG) {
    this.config = config;
    this.sampleCanvas = document.createElement('canvas');
    this.blurCanvas = document.createElement('canvas');
    this.dotsCanvas = document.createElement('canvas');
    this.bloomCanvas = document.createElement('canvas');
    this.atlasCanvas = document.createElement('canvas');

    const sampleCtx = this.sampleCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    const blurCtx = this.blurCanvas.getContext('2d');
    const dotsCtx = this.dotsCanvas.getContext('2d');
    const bloomCtx = this.bloomCanvas.getContext('2d');
    const atlasCtx = this.atlasCanvas.getContext('2d');

    if (!sampleCtx || !blurCtx || !dotsCtx || !bloomCtx || !atlasCtx) {
      throw new Error('2D canvas context unavailable for ASCII renderer');
    }

    this.sampleCtx = sampleCtx;
    this.blurCtx = blurCtx;
    this.dotsCtx = dotsCtx;
    this.bloomCtx = bloomCtx;
    this.atlasCtx = atlasCtx;
  }

  /**
   * Pre-render Matrix vertical stream glyphs into a compact 4-row sprite atlas
   * blending the channel palette with subtle neon Matrix green (zero per-frame fillText/shadowBlur).
   */
  private ensureAtlas(profile: AsciiChannelProfile, cellSize: number): number {
    const slot = Math.max(12, Math.ceil(cellSize * 1.15));
    const key = `${profile.shadowHex}|${profile.tintHex}|${profile.highlightHex}|${slot}|neon`;
    if (this.atlasKey === key && this.atlasCanvas.width > 0) {
      return this.atlasSlot;
    }

    const [sr, sg, sb] = parseHexColor(profile.shadowHex);
    const [tr, tg, tb] = parseHexColor(profile.tintHex);
    const [hr, hg, hb] = parseHexColor(profile.highlightHex);

    const rowColors = [
      // Row 0: muted tail blended with deep Matrix green
      `rgb(${clampByte(sr * 0.25 + tr * 0.43 + 32 * 0.32)},${clampByte(sg * 0.25 + tg * 0.43 + 178 * 0.32)},${clampByte(sb * 0.25 + tb * 0.43 + 96 * 0.32)})`,
      // Row 1: body glyph (channel tint infused with neon Matrix green)
      `rgb(${clampByte(tr * 0.56 + 52 * 0.44)},${clampByte(tg * 0.56 + 236 * 0.44)},${clampByte(tb * 0.56 + 124 * 0.44)})`,
      // Row 2: vibrant neon Matrix green with slight channel highlight harmony
      `rgb(${clampByte(Math.min(220, hr * 0.26 + 86 * 0.74))},${clampByte(Math.min(252, hg * 0.26 + 255 * 0.74))},${clampByte(Math.min(220, hb * 0.26 + 148 * 0.74))})`,
      // Row 3: soft phosphor-mint leading glyph
      `rgb(${clampByte(Math.min(234, hr * 0.32 + 164 * 0.68))},${clampByte(Math.min(255, hg * 0.32 + 255 * 0.68))},${clampByte(Math.min(232, hb * 0.32 + 198 * 0.68))})`,
    ];

    const charCount = STREAM_CHARS.length;
    this.atlasCanvas.width = charCount * slot;
    this.atlasCanvas.height = ATLAS_TONE_ROWS * slot;
    this.atlasCtx.clearRect(0, 0, this.atlasCanvas.width, this.atlasCanvas.height);

    const fontPx = Math.max(11, Math.round(cellSize * 0.94));
    this.atlasCtx.font = `600 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    this.atlasCtx.textAlign = 'center';
    this.atlasCtx.textBaseline = 'middle';

    const half = slot * 0.5;
    for (let row = 0; row < ATLAS_TONE_ROWS; row++) {
      this.atlasCtx.fillStyle = rowColors[row];
      const cy = row * slot + half;
      for (let i = 0; i < charCount; i++) {
        this.atlasCtx.fillText(STREAM_CHARS[i], i * slot + half, cy);
      }
    }

    this.atlasKey = key;
    this.atlasSlot = slot;
    return slot;
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
    accentHex: string,
    highlightHex: string,
    tintHex: string
  ): void {
    const tick = Math.floor(timeSec * 16);
    const bandCount = Math.max(3, Math.round(4 + surge * 5));
    const chromaColors = [accentHex, highlightHex, tintHex];

    ctx.save();
    for (let i = 0; i < bandCount; i++) {
      const seed = tick * 31 + i * 53;
      const yFrac = pseudoRand(seed + 1) * 0.92 + 0.04;
      const hFrac = (0.006 + pseudoRand(seed + 2) * 0.024) * (0.65 + surge * 0.6);
      const dstY = yFrac * height;
      const dstH = Math.max(2, hFrac * height);
      const srcY = crop.sy + yFrac * crop.sh;
      const srcH = Math.max(1, hFrac * crop.sh);
      const shiftX = (pseudoRand(seed + 3) - 0.5) * 2 * (10 + surge * 34);

      // Soft horizontal video strip drift
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(0.62, 0.22 + surge * 0.36);
      ctx.drawImage(source, crop.sx, srcY, crop.sw, srcH, shiftX, dstY, width, dstH);

      // Palette-matched optical hairline along the shift edge
      const chroma = chromaColors[i % chromaColors.length];
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(0.32, 0.08 + surge * 0.22);
      ctx.fillStyle = chroma;
      ctx.fillRect(shiftX * 0.5, dstY, width, Math.max(1, dstH * 0.16));

      if (i % 3 === 0) {
        const strip = GLITCH_STRIPS[Math.floor(pseudoRand(seed + 7) * GLITCH_STRIPS.length)];
        const tx = width * (0.08 + pseudoRand(seed + 11) * 0.8);
        ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = Math.min(0.45, 0.14 + surge * 0.32);
        ctx.fillStyle = highlightHex;
        ctx.fillText(`${strip} // ░`, tx, dstY + dstH * 0.5);
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
    // Cap background ambient canvas at DPR=1 for smooth 60fps Chrome compositing on Retina/4K screens
    const dpr = Math.max(1, Math.min(1, options.dpr || 1));
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
    const cellSize = Math.max(10, Math.round(profile.cellSize));
    const cols = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    const crop = computeCoverRect(dims.width, dims.height, width, height, options.scale ?? 1);

    // Periodic clean video-slice glitch bursts in normal playback (no horizontal text strips in the sky),
    // and continuous glitch surge during channel transfer portal.
    const animated = this.config.animated && options.animate;
    const isPortalTransfer = Boolean(options.continuousGlitch) || transferSurge > 0.02;
    let effectiveGlitch = 0;
    if (animated) {
      if (isPortalTransfer) {
        effectiveGlitch = clamp01(profile.glitchIntensity + transferSurge * 0.52);
      } else if (profile.glitchIntensity > 0.01) {
        const wave =
          0.5 +
          0.3 * Math.sin(options.timeSec * 1.18) +
          0.2 * Math.sin(options.timeSec * 0.43 + 1.9);
        const burst = clamp01((wave - 0.66) / 0.24);
        effectiveGlitch = clamp01(profile.glitchIntensity * burst);
      }
    }

    // 1. Throttled video luminance sampling (~12Hz) to avoid synchronous GPU->CPU readback every frame
    const nowMs = options.timeSec * 1000;
    const sampleInterval = transferSurge > 0.05 ? 48 : SAMPLE_INTERVAL_MS;
    const needsResample =
      !this.cachedPixels ||
      this.cachedCols !== cols ||
      this.cachedRows !== rows ||
      nowMs - this.lastSampleAt >= sampleInterval ||
      nowMs < this.lastSampleAt;

    if (needsResample) {
      if (this.sampleCanvas.width !== cols || this.sampleCanvas.height !== rows) {
        this.sampleCanvas.width = cols;
        this.sampleCanvas.height = rows;
      }
      this.sampleCtx.imageSmoothingEnabled = true;
      this.sampleCtx.imageSmoothingQuality = 'low';
      this.sampleCtx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, cols, rows);
      this.cachedPixels = this.sampleCtx.getImageData(0, 0, cols, rows).data;
      this.cachedCols = cols;
      this.cachedRows = rows;
      this.lastSampleAt = nowMs;
    }
    const pixels = this.cachedPixels!;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    // 2. Render live video frame on ALL channels
    ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);

    if (profile.bgBlur >= 0.8) {
      const blurScale = Math.max(4, Math.round(profile.bgBlur * 2.5));
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

    // Channel mood color-grading tint over the live video (single multiply pass for fast compositing)
    if (profile.duotoneMix > 0.16) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = clamp01(profile.duotoneMix * 0.56);
      ctx.fillStyle = profile.tintHex;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // Light translucent atmospheric veil (capped at <= 34% so live video always shines through)
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
        effectiveGlitch * (isPortalTransfer ? 0.78 : 0.92),
        profile.accentGlowHex,
        isPortalTransfer && profile.glyphAccent > 0.2
      );
    }

    // 3. Render calm, sparse vertical descending Matrix character streams using pre-rendered Sprite Atlas
    if (this.dotsCanvas.width !== pixelW || this.dotsCanvas.height !== pixelH) {
      this.dotsCanvas.width = pixelW;
      this.dotsCanvas.height = pixelH;
    }
    this.dotsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dotsCtx.clearRect(0, 0, width, height);
    this.dotsCtx.imageSmoothingEnabled = false;

    const atlasSlot = this.ensureAtlas(profile, cellSize);
    const halfSlot = atlasSlot * 0.5;
    const atlas = this.atlasCanvas;
    const halfCell = cellSize * 0.5;
    const charCount = STREAM_CHARS.length;

    // Stratified placement (~25–33% of columns in steady playback, always leaving breathing gaps between streams)
    const stride = isPortalTransfer
      ? 2
      : Math.max(3, Math.min(4, Math.round(4.6 - asciiMix * 3.8)));
    const rainSpeedScale = isPortalTransfer ? 1 + transferSurge * 1.6 : 1;
    // Slow, gentle breathing envelope (~4.6s period) for subtle neon green pulse at near-zero CPU cost
    const neonPulse = animated ? 0.5 + 0.5 * Math.sin(options.timeSec * 1.35) : 0.5;

    for (let col = 0; col < cols; col++) {
      const slot = Math.floor(col / stride);
      const local = col - slot * stride;
      const pick =
        stride <= 2
          ? Math.floor(pseudoRand(slot * 47.13 + 11.7) * stride)
          : Math.floor(pseudoRand(slot * 47.13 + 11.7) * (stride - 1));
      if (local !== pick) continue;

      const cx = col * cellSize + halfCell;
      const colSpeed = (0.85 + pseudoRand(col * 37.19 + 3.1) * 1.1) * rainSpeedScale;
      const trailLen = 11 + Math.floor(pseudoRand(col * 53.17 + 1.9) * 10);
      const extraGap = 4 + Math.floor(pseudoRand(col * 29.43 + 5.7) * 8);
      const rainSpan = rows + trailLen + extraGap;
      const colPhase = pseudoRand(col * 71.41 + 2.3) * rainSpan;
      const travel = animated ? options.timeSec * colSpeed + colPhase : colPhase;
      const cycleIdx = Math.floor(travel / rainSpan);
      const rainHead = (travel % rainSpan) - 2;

      const rowStart = Math.max(0, Math.floor(rainHead - trailLen) + 1);
      const rowEnd = Math.min(rows - 1, Math.floor(rainHead));
      if (rowStart > rowEnd) continue;

      const colBreath = animated
        ? 0.86 + 0.14 * Math.sin(options.timeSec * 1.35 + col * 0.45)
        : 0.94;
      const colDepthAlpha = (0.78 + pseudoRand(col * 83.11 + 4.1) * 0.22) * colBreath;

      for (let row = rowStart; row <= rowEnd; row++) {
        const rainDist = rainHead - row;
        if (rainDist < 0 || rainDist >= trailLen) continue;

        // Smooth fade-in at the leading edge and readable long tail fade-out
        const headFade = clamp01(rainDist / 1.25);
        const smoothHead = headFade * headFade * (3 - 2 * headFade);
        const tailFade = Math.pow(1 - rainDist / trailLen, 1.15);
        const cellStrength = smoothHead * tailFade;
        const alpha = cellStrength * colDepthAlpha;
        if (alpha < 0.03) continue;

        // Stable Matrix glyph per (col, row, cycle) so characters flow down calmly without flickering
        const charIdx = Math.floor(
          pseudoRand(col * 31.7 + row * 17.3 + cycleIdx * 13.1) * charCount
        );
        const toneRow =
          rainDist < 1.2 ? 3 : rainDist < 3.4 ? 2 : cellStrength > 0.34 ? 1 : 0;
        const cy = row * cellSize + halfCell;

        this.dotsCtx.globalAlpha = alpha;
        this.dotsCtx.drawImage(
          atlas,
          charIdx * atlasSlot,
          toneRow * atlasSlot,
          atlasSlot,
          atlasSlot,
          cx - halfSlot,
          cy - halfSlot,
          atlasSlot,
          atlasSlot
        );
      }
    }
    this.dotsCtx.globalAlpha = 1;

    // 4. Composite vertical Matrix stream layer over live video via `screen` blend
    const baseDotsAlpha = 0.66 + asciiMix * 0.22 + (neonPulse - 0.5) * 0.1;
    const dotsAlpha = isPortalTransfer
      ? clamp01(baseDotsAlpha + transferSurge * 0.2)
      : clamp01(baseDotsAlpha);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = dotsAlpha;
    ctx.drawImage(this.dotsCanvas, 0, 0, width, height);
    ctx.restore();

    if (isPortalTransfer && effectiveGlitch > 0.04) {
      this.drawDotsGlitchSlices(
        ctx,
        dpr,
        width,
        height,
        options.timeSec,
        effectiveGlitch * (0.4 + asciiMix * 0.5),
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
        profile.accentGlowHex,
        profile.highlightHex,
        profile.tintHex
      );
    }

    // 5. Ultra-lightweight pulsing neon Matrix green bloom (1/10th resolution canvas, zero per-glyph blur)
    if (this.config.bloomEnabled && profile.bloomIntensity > 1) {
      const bloomW = Math.max(24, Math.round(width / 10));
      const bloomH = Math.max(18, Math.round(height / 10));

      if (this.bloomCanvas.width !== bloomW || this.bloomCanvas.height !== bloomH) {
        this.bloomCanvas.width = bloomW;
        this.bloomCanvas.height = bloomH;
      }

      this.bloomCtx.globalCompositeOperation = 'source-over';
      this.bloomCtx.globalAlpha = 1;
      this.bloomCtx.clearRect(0, 0, bloomW, bloomH);
      this.bloomCtx.imageSmoothingEnabled = true;
      this.bloomCtx.drawImage(this.dotsCanvas, 0, 0, bloomW, bloomH);

      // Tint only the downsampled glyph silhouette with Matrix neon green (costs ~0.02ms on ~144x90 buffer)
      this.bloomCtx.globalCompositeOperation = 'source-atop';
      this.bloomCtx.globalAlpha = 0.52 + 0.24 * neonPulse;
      this.bloomCtx.fillStyle = MATRIX_NEON_GREEN_HEX;
      this.bloomCtx.fillRect(0, 0, bloomW, bloomH);
      this.bloomCtx.globalCompositeOperation = 'source-over';
      this.bloomCtx.globalAlpha = 1;

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(
        0.34,
        (profile.bloomIntensity / 100) * (0.95 + 0.7 * neonPulse) * dotsAlpha
      );
      ctx.drawImage(this.bloomCanvas, 0, 0, width, height);
      ctx.restore();
    }

    // 5b. Autonomous & interactive ASCII Globe drifting calmly across the sky
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
      glitchStrength: isPortalTransfer ? effectiveGlitch : 0,
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
    this.bloomCanvas.width = 0;
    this.atlasCanvas.width = 0;
    this.atlasKey = '';
    this.cachedPixels = null;
    this.vignetteGradient = null;
  }
}
