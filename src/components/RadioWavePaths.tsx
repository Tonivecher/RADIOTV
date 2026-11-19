import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

interface RadioWavePathsProps {
  channelId: string;
  className?: string;
}

interface RibbonLayer {
  count: number;
  width: number;
  opacity: number;
  phase: number;
  pace: number;
  part: number;
}

const LAYERS: readonly RibbonLayer[] = [
  { count: 6, width: 1.0, opacity: 0.14, phase: 0.6, pace: 0.65, part: 0.45 },
  { count: 7, width: 1.25, opacity: 0.22, phase: 0.3, pace: 0.82, part: 0.75 },
  { count: 7, width: 1.5, opacity: 0.32, phase: 0.0, pace: 1.0, part: 1.0 },
];

const TOTAL_LINES = LAYERS.reduce((sum, layer) => sum + layer.count, 0);
const SAMPLES = 56;
const OVERSCAN = 0.06;
const DRAW_MS = 1350;
const DRAW_STAGGER_MS = 42;
const PART_RADIUS = 150;
const PART_PUSH = 42;
const MAX_DPR = 1.5;

const CHANNEL_ACCENT_FALLBACK: Record<string, string> = {
  'ch-main': '231,187,148',
  'ch-deep': '223,128,120',
  'ch-afterglow': '177,156,232',
};

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

function readAccentColor(channelId: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-rgb')
    .trim();
  const rgb = raw || CHANNEL_ACCENT_FALLBACK[channelId] || '231,187,148';
  return `rgb(${rgb})`;
}

interface PointerState {
  x: number;
  y: number;
  amount: number;
  on: boolean;
}

interface FrameState {
  width: number;
  height: number;
  time: number;
  drawn: number[];
  pointer: PointerState;
}

function lineY(
  s: number,
  u: number,
  layer: RibbonLayer,
  frame: FrameState,
  slope: number,
  band: number
): number {
  const t = frame.time * layer.pace;
  const x = u * frame.width;
  const center =
    frame.height * 0.5 +
    slope * (x - frame.width * 0.5) +
    band * 0.09 * Math.sin(Math.PI * 2 * (0.75 * u + 0.1) + layer.phase + t * 0.34);
  const turn = 0.22 + 0.09 * Math.sin(t * 0.2 + layer.phase);
  const breathe = 0.28 * Math.sin(t * 0.48 + s * 4 + layer.phase);
  const twist = Math.cos(Math.PI * (u - turn) + s * (0.6 + breathe) + layer.phase);
  return center + s * band * 0.92 * twist;
}

function applyPointerPart(x: number, y: number, frame: FrameState, strength: number): number {
  const { pointer } = frame;
  if (pointer.amount < 0.001) return y;
  const dx = x - pointer.x;
  const dy = y - pointer.y;
  const falloff = Math.exp(-(dx * dx + dy * dy) / (PART_RADIUS * PART_RADIUS));
  const side = dy / (Math.abs(dy) + 24);
  return y + side * falloff * PART_PUSH * strength * pointer.amount;
}

function drawPaths(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  slope: number,
  strokeColor: string,
  interactive: boolean,
  xs: Float32Array,
  ys: Float32Array
): void {
  const { width, height } = frame;
  if (width <= 0 || height <= 0) return;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = strokeColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const band = Math.min(height, width * 1.1);
  let lineOffset = 0;

  for (let layerIdx = 0; layerIdx < LAYERS.length; layerIdx++) {
    const layer = LAYERS[layerIdx];
    const perLayer = layer.count;
    ctx.lineWidth = layer.width;

    for (let i = 0; i < perLayer; i++) {
      const drawn = frame.drawn[lineOffset + i] ?? 1;
      if (drawn <= 0) continue;

      const s = perLayer === 1 ? 0 : i / (perLayer - 1) - 0.5;
      const last = Math.max(1, Math.ceil(SAMPLES * drawn));

      for (let k = 0; k <= last; k++) {
        const u = -OVERSCAN + (k / SAMPLES) * (1 + OVERSCAN * 2);
        const x = u * width;
        const y = lineY(s, u, layer, frame, slope, band);
        xs[k] = x;
        ys[k] = interactive ? applyPointerPart(x, y, frame, layer.part) : y;
      }

      ctx.globalAlpha = layer.opacity * (0.45 + 0.55 * (1 - Math.abs(s) * 2));
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let k = 1; k < last; k++) {
        const mx = (xs[k] + xs[k + 1]) * 0.5;
        const my = (ys[k] + ys[k + 1]) * 0.5;
        ctx.quadraticCurveTo(xs[k], ys[k], mx, my);
      }
      ctx.lineTo(xs[last], ys[last]);
      ctx.stroke();
    }

    lineOffset += perLayer;
  }

  ctx.globalAlpha = 1;
}

/**
 * Canvas 2D v2 flowing bezier ribbons synced to the active channel accent.
 * Uses a single canvas with DPR capped at 1.5 and pauses when off-screen or hidden.
 */
export const RadioWavePaths: React.FC<RadioWavePathsProps> = ({ channelId, className }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = Boolean(useReducedMotion());
  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;

  const paintRef = useRef<() => void>(() => {});
  const colorRef = useRef<string>('rgb(231,187,148)');

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!root || !canvas || !ctx) return;

    const host = root.parentElement || root;
    const slope = Math.tan((-7 * Math.PI) / 180);
    const xs = new Float32Array(SAMPLES + 1);
    const ys = new Float32Array(SAMPLES + 1);

    const frame: FrameState = {
      width: 0,
      height: 0,
      time: 36,
      drawn: new Array<number>(TOTAL_LINES).fill(reducedMotion ? 1 : 0),
      pointer: { x: 0, y: 0, amount: 0, on: false },
    };

    colorRef.current = readAccentColor(channelIdRef.current);

    let startMs = 0;
    let lastMs = 0;
    let rafId = 0;
    let onScreen = true;
    let active = onScreen && document.visibilityState === 'visible';

    const paint = () => {
      drawPaths(ctx, frame, slope, colorRef.current, !reducedMotion, xs, ys);
    };
    paintRef.current = paint;

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(MAX_DPR, window.devicePixelRatio || 1));
      frame.width = Math.max(1, rect.width);
      frame.height = Math.max(1, rect.height);
      canvas.width = Math.max(1, Math.round(frame.width * dpr));
      canvas.height = Math.max(1, Math.round(frame.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint();
    };

    const tick = (nowMs: number) => {
      rafId = 0;
      if (!active || reducedMotion) return;

      if (!startMs) {
        startMs = nowMs;
        lastMs = nowMs;
      }
      const dt = Math.min((nowMs - lastMs) / 1000, 0.05);
      lastMs = nowMs;
      frame.time += dt * 0.72;

      const elapsed = nowMs - startMs;
      for (let i = 0; i < frame.drawn.length; i++) {
        if (frame.drawn[i] < 1) {
          const local = (elapsed - (i % 7) * DRAW_STAGGER_MS) / DRAW_MS;
          frame.drawn[i] = easeOutCubic(Math.min(Math.max(local, 0), 1));
        }
      }

      const { pointer } = frame;
      pointer.amount += ((pointer.on ? 1 : 0) - pointer.amount) * 0.08;

      paint();
      rafId = window.requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (!rafId && active && !reducedMotion) {
        lastMs = performance.now();
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const stopLoop = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const updateActivity = () => {
      active = onScreen && document.visibilityState === 'visible';
      if (active) {
        if (reducedMotion) {
          paint();
        } else {
          startLoop();
        }
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
        updateActivity();
      },
      { rootMargin: '120px' }
    );
    intersectionObserver.observe(host);

    const onVisibilityChange = () => {
      updateActivity();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const themeObserver = new MutationObserver(() => {
      const next = readAccentColor(channelIdRef.current);
      if (next !== colorRef.current) {
        colorRef.current = next;
        paint();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion || event.pointerType !== 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      frame.pointer.x = event.clientX - rect.left;
      frame.pointer.y = event.clientY - rect.top;
      frame.pointer.on = true;
    };

    const onPointerLeave = () => {
      frame.pointer.on = false;
    };

    host.addEventListener('pointermove', onPointerMove, { passive: true });
    host.addEventListener('pointerleave', onPointerLeave, { passive: true });

    updateActivity();

    return () => {
      stopLoop();
      paintRef.current = () => {};
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [reducedMotion]);

  useEffect(() => {
    colorRef.current = readAccentColor(channelId);
    paintRef.current();
  }, [channelId]);

  return (
    <div
      ref={rootRef}
      className={className ? `lounge-wave-paths ${className}` : 'lounge-wave-paths'}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="lounge-wave-paths__canvas" />
    </div>
  );
};
