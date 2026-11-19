import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

interface TactileDotMatrixProps {
  className?: string;
}

interface DotRipple {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  bornMs: number;
}

interface PaletteRgb {
  r: number;
  g: number;
  b: number;
}

const DOT_STEP = 22;
const DOT_BASE_RADIUS = 1.0;
const DOT_PEAK_RADIUS = 1.9;
const DOT_BASE_ALPHA = 0.19;
const DOT_ACTIVE_ALPHA = 0.56;
const INFLUENCE_RADIUS = 156;
const MAX_WARP = 3.2;
const RIPPLE_SPEED = 290;
const RIPPLE_WIDTH = 46;
const MAX_DPR = 1.5;

let probeCtx: CanvasRenderingContext2D | null | undefined;

function parseCssColor(css: string, fallback: PaletteRgb): PaletteRgb {
  if (!css) return fallback;
  if (probeCtx === undefined) {
    probeCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  }
  if (!probeCtx) return fallback;
  probeCtx.clearRect(0, 0, 1, 1);
  probeCtx.fillStyle = '#000000';
  probeCtx.fillStyle = css;
  probeCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
}

function parseAccentTuple(raw: string): PaletteRgb {
  const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return { r: 231, g: 187, b: 148 };
}

function readMatrixPalette(): { base: PaletteRgb; accent: PaletteRgb } {
  const style = getComputedStyle(document.documentElement);
  const baseCss = style.getPropertyValue('--text-muted').trim() || '#d4c4aa';
  const accentRaw = style.getPropertyValue('--accent-rgb').trim();
  const base = parseCssColor(baseCss, { r: 212, g: 196, b: 170 });
  const accent = accentRaw
    ? parseAccentTuple(accentRaw)
    : parseCssColor(style.getPropertyValue('--accent-primary').trim(), { r: 231, g: 187, b: 148 });
  return { base, accent };
}

/**
 * Tactile Canvas 2D dot matrix for the DSP console backdrop.
 * Combines pointer flow-field warp, click ripples, and audio-reactive organic breathing.
 */
export const TactileDotMatrix: React.FC<TactileDotMatrixProps> = ({ className }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!root || !canvas || !ctx) return;

    const host: HTMLElement =
      root.closest<HTMLElement>('#dsp-stage') || root.parentElement || root;
    const targetPointer = { x: -9999, y: -9999, on: false };
    const pointer = { x: -9999, y: -9999, amount: 0 };
    const ripples: DotRipple[] = [];

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let lastDrawMs = 0;
    let onScreen = true;
    let visible = document.visibilityState === 'visible';
    let palette = readMatrixPalette();

    const drawFrame = (nowMs: number) => {
      if (width <= 0 || height <= 0) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        const ageSec = (nowMs - r.bornMs) / 1000;
        r.radius = ageSec * RIPPLE_SPEED;
        r.opacity = Math.max(0, 1 - ageSec * 1.15);
        if (r.opacity <= 0) {
          ripples.splice(i, 1);
        }
      }

      const { base, accent } = palette;
      const startX = ((width % DOT_STEP) + DOT_STEP) * 0.5;
      const startY = ((height % DOT_STEP) + DOT_STEP) * 0.5;
      const basePath = new Path2D();

      for (let gx = startX; gx < width; gx += DOT_STEP) {
        for (let gy = startY; gy < height; gy += DOT_STEP) {
          let offsetX = 0;
          let offsetY = 0;
          let glow = 0;

          if (!reducedMotion && pointer.amount > 0.002) {
            const dx = gx - pointer.x;
            const dy = gy - pointer.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < INFLUENCE_RADIUS * INFLUENCE_RADIUS && distSq > 0.01) {
              const dist = Math.sqrt(distSq);
              const t = 1 - dist / INFLUENCE_RADIUS;
              const smooth = t * t * (3 - 2 * t) * pointer.amount;
              offsetX += (dx / dist) * MAX_WARP * smooth;
              offsetY += (dy / dist) * MAX_WARP * smooth;
              glow = Math.max(glow, smooth);
            }
          }

          if (!reducedMotion && ripples.length > 0) {
            for (let i = 0; i < ripples.length; i++) {
              const r = ripples[i];
              const rdx = gx - r.x;
              const rdy = gy - r.y;
              const rDist = Math.sqrt(rdx * rdx + rdy * rdy);
              const diff = Math.abs(rDist - r.radius);
              if (diff < RIPPLE_WIDTH && rDist > 0.01) {
                const wave = (1 - diff / RIPPLE_WIDTH) * r.opacity;
                offsetX += (rdx / rDist) * 2.8 * wave;
                offsetY += (rdy / rDist) * 2.8 * wave;
                glow = Math.max(glow, wave * 0.95);
              }
            }
          }

          if (glow <= 0.02) {
            basePath.moveTo(gx + DOT_BASE_RADIUS, gy);
            basePath.arc(gx, gy, DOT_BASE_RADIUS, 0, Math.PI * 2);
          } else {
            const clampedGlow = Math.min(1, glow);
            const r = Math.round(base.r + (accent.r - base.r) * clampedGlow);
            const g = Math.round(base.g + (accent.g - base.g) * clampedGlow);
            const b = Math.round(base.b + (accent.b - base.b) * clampedGlow);
            const alpha = DOT_BASE_ALPHA + (DOT_ACTIVE_ALPHA - DOT_BASE_ALPHA) * clampedGlow;
            const rad = DOT_BASE_RADIUS + (DOT_PEAK_RADIUS - DOT_BASE_RADIUS) * clampedGlow;
            ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(gx + offsetX, gy + offsetY, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      ctx.fillStyle = `rgba(${base.r},${base.g},${base.b},${DOT_BASE_ALPHA})`;
      ctx.fill(basePath);
    };

    const stopLoop = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const tick = (nowMs: number) => {
      rafId = 0;
      if (
        !onScreen ||
        !visible ||
        reducedMotion ||
        document.hidden ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        return;
      }

      pointer.x += (targetPointer.x - pointer.x) * 0.14;
      pointer.y += (targetPointer.y - pointer.y) * 0.14;
      pointer.amount += ((targetPointer.on ? 1 : 0) - pointer.amount) * 0.1;

      const frameBudget = targetPointer.on || ripples.length > 0 ? 20 : 42;
      if (nowMs - lastDrawMs >= frameBudget) {
        lastDrawMs = nowMs;
        drawFrame(nowMs);
      }

      const settling = targetPointer.on || pointer.amount > 0.002 || ripples.length > 0;
      if (settling) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        pointer.amount = 0;
        drawFrame(nowMs);
      }
    };

    const wake = () => {
      if (reducedMotion) {
        drawFrame(performance.now());
        return;
      }
      if (!rafId && onScreen && visible) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const resize = () => {
      const rect = root.getBoundingClientRect();
      dpr = Math.max(1, Math.min(MAX_DPR, window.devicePixelRatio || 1));
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      drawFrame(performance.now());
    };

    const toLocal = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion || event.pointerType === 'touch') return;
      const local = toLocal(event.clientX, event.clientY);
      if (!targetPointer.on && pointer.x < -5000) {
        pointer.x = local.x;
        pointer.y = local.y;
      }
      targetPointer.x = local.x;
      targetPointer.y = local.y;
      targetPointer.on = true;
      wake();
    };

    const onPointerLeave = () => {
      targetPointer.on = false;
      wake();
    };

    const onClick = (event: MouseEvent) => {
      if (reducedMotion || !onScreen || !visible) return;
      const local = toLocal(event.clientX, event.clientY);
      if (local.x < 0 || local.y < 0 || local.x > width || local.y > height) return;
      if (ripples.length >= 4) {
        ripples.shift();
      }
      ripples.push({
        x: local.x,
        y: local.y,
        radius: 0,
        opacity: 1,
        bornMs: performance.now(),
      });
      wake();
    };

    const onVisibilityChange = () => {
      visible = document.visibilityState === 'visible';
      if (visible && onScreen) {
        drawFrame(performance.now());
        wake();
      } else {
        stopLoop();
      }
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen && visible) {
          drawFrame(performance.now());
          wake();
        } else {
          stopLoop();
        }
      },
      { rootMargin: '120px' }
    );
    intersectionObserver.observe(host);

    const themeObserver = new MutationObserver(() => {
      palette = readMatrixPalette();
      drawFrame(performance.now());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    document.addEventListener('visibilitychange', onVisibilityChange);
    host.addEventListener('pointermove', onPointerMove, { passive: true });
    host.addEventListener('pointerleave', onPointerLeave, { passive: true });
    host.addEventListener('click', onClick, { passive: true });

    return () => {
      stopLoop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('click', onClick);
    };
  }, [reducedMotion]);

  return (
    <div
      ref={rootRef}
      className={className ? `dsp-dot-matrix ${className}` : 'dsp-dot-matrix'}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="dsp-dot-matrix__canvas" />
    </div>
  );
};
