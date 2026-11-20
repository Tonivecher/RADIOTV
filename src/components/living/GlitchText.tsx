import React, { type CSSProperties, type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type GlitchTextTrigger = 'idle' | 'hover' | 'change' | 'both';
export type GlitchTextIntensity = 'subtle' | 'medium' | 'strong';

export interface GlitchTextProps {
  text: string;
  trigger?: GlitchTextTrigger;
  intensity?: GlitchTextIntensity;
  accent?: string;
  secondaryAccent?: string;
  className?: string;
  as?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3';
  /** Trigger an immediate glitch burst on mount (used by channel transfer portal). */
  burstOnMount?: boolean;
  /** Interactive directional shadow shift on mouse near text (inspired by ShadowText). */
  interactiveShadow?: boolean;
}

interface Settings {
  bands: number;
  shift: number;
  split: number;
  frames: number;
  frame: number;
}

const INTENSITY: Record<GlitchTextIntensity, Settings> = {
  subtle: { bands: 3, shift: 0.045, split: 1.5, frames: 5, frame: 52 },
  medium: { bands: 4, shift: 0.11, split: 2.5, frames: 6, frame: 50 },
  strong: { bands: 5, shift: 0.18, split: 4, frames: 8, frame: 46 },
};

const MAX_BANDS = 5;
const BAND_IDS = Array.from({ length: MAX_BANDS }, (_, i) => `b-${i}`);
const HOLD = 'steps(1, end)';
const FIRST_IDLE_MS = 2800;
const IDLE_MIN_MS = 6500;
const IDLE_SPREAD_MS = 6500;
const STILL_CHANCE = 0.28;

const round = (n: number) => Math.round(n * 1000) / 1000;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const held = (frames: Keyframe[]): Keyframe[] => [
  ...frames.map((k, i) => ({ ...k, offset: i / frames.length, easing: HOLD })),
  { ...frames[frames.length - 1], offset: 1 },
];

const randomCuts = (count: number) => {
  const weights = Array.from({ length: count }, () => 0.55 + Math.random());
  const total = weights.reduce((a, b) => a + b, 0);
  const cuts = [0];
  for (const w of weights) {
    cuts.push(round((cuts[cuts.length - 1] ?? 0) + (w / total) * 100));
  }
  return cuts;
};

const jump = (max: number) => {
  if (Math.random() < STILL_CHANCE) return 0;
  const sign = Math.random() < 0.5 ? -1 : 1;
  return round(sign * (0.28 + 0.72 * Math.random()) * max);
};

const bandPath = (s: Settings, forceMove: boolean) =>
  Array.from({ length: s.frames }, (_, f) => {
    if (f === s.frames - 1) return 0;
    const x = jump(s.shift);
    return f === 0 && forceMove && x === 0 ? round(s.shift * 0.65) : x;
  });

function LayerText({ from, to }: { from: string | null; to: string }) {
  return (
    <>
      {from !== null && (
        <span className="glitch-text__cell glitch-text__cell--hidden" data-text="from">
          {from}
        </span>
      )}
      <span className="glitch-text__cell" data-text="to">
        {to}
      </span>
    </>
  );
}

/**
 * Signal glitch text adapted from KokonutUI GlitchText + ShadowText contour glow.
 * Cuts into horizontal bands with red/cyan chromatic offsets on idle, hover, or text swap.
 */
export const GlitchText: React.FC<GlitchTextProps> = ({
  text,
  trigger = 'both',
  intensity = 'subtle',
  accent = 'var(--accent-primary, #e7bb94)',
  secondaryAccent = '#5ed6e8',
  className = '',
  as: Root = 'span',
  burstOnMount = false,
  interactiveShadow = false,
}) => {
  const rootRef = useRef<HTMLElement>(null);
  const layersRef = useRef<HTMLSpanElement>(null);
  const animsRef = useRef<Animation[]>([]);
  const runningRef = useRef(false);
  const watchdogRef = useRef<number | undefined>(undefined);
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  const [shown, setShown] = useState<{ from: string | null; to: string; id: number }>({
    from: null,
    to: text,
    id: 0,
  });

  if (shown.to !== text) {
    setShown({ from: shown.to, to: text, id: shown.id + 1 });
  }

  const stop = useCallback(() => {
    window.clearTimeout(watchdogRef.current);
    for (const a of animsRef.current) {
      a.cancel();
    }
    animsRef.current = [];
    runningRef.current = false;
  }, []);

  const burst = useCallback(
    (swap: boolean, onDone?: () => void) => {
      const layers = layersRef.current;
      if (!layers || typeof layers.animate !== 'function') {
        onDone?.();
        return;
      }
      stop();
      const s = INTENSITY[intensityRef.current];
      const opts: KeyframeAnimationOptions = {
        duration: s.frames * s.frame,
        fill: 'none',
      };
      const anims: Animation[] = [];
      const run = (el: Element, frames: Keyframe[]) => {
        anims.push(el.animate(held(frames), opts));
      };

      const base = layers.querySelector('[data-layer="base"]');
      if (base) {
        run(
          base,
          Array.from({ length: s.frames }, (_, f) => ({
            opacity: f === s.frames - 1 ? 1 : 0,
          }))
        );
      }

      const cuts = randomCuts(s.bands);
      const bands = layers.querySelectorAll<HTMLElement>('[data-layer="band"]');
      const mover = Math.floor(Math.random() * s.bands);
      bands.forEach((band, i) => {
        if (i >= s.bands) return;
        const top = i === 0 ? -40 : cuts[i];
        const bottom = i === s.bands - 1 ? -40 : round(100 - cuts[i + 1]);
        band.style.clipPath = `inset(${top}% -22% ${bottom}% -22%)`;
        run(
          band,
          bandPath(s, i === mover).map((x) => ({
            opacity: 1,
            transform: `translate3d(${x}em, 0, 0)`,
          }))
        );
      });

      const channels = layers.querySelectorAll('[data-layer="channel"]');
      const offsets = Array.from({ length: s.frames }, () =>
        Math.max(1, Math.ceil(Math.random() * s.split))
      );
      channels.forEach((channel, c) => {
        const dir = c === 0 ? -1 : 1;
        run(
          channel,
          offsets.map((d, f) => ({
            opacity: f === s.frames - 1 ? 0 : 0.88,
            transform: `translate3d(${dir * d}px, ${c === 0 ? -0.5 : 0.5}px, 0)`,
          }))
        );
      });

      if (swap) {
        const half = Math.ceil(s.frames / 2);
        const flip = (selector: string, before: number) => {
          for (const el of layers.querySelectorAll(selector)) {
            run(
              el,
              Array.from({ length: s.frames }, (_, f) => ({
                opacity: f < half ? before : 1 - before,
              }))
            );
          }
        };
        flip('[data-layer]:not([data-layer="base"]) [data-text="from"]', 1);
        flip('[data-layer]:not([data-layer="base"]) [data-text="to"]', 0);
      }

      animsRef.current = anims;
      runningRef.current = true;
      const last = anims[anims.length - 1];
      const settleBurst = () => {
        if (animsRef.current !== anims) return;
        for (const a of anims) {
          a.cancel();
        }
        animsRef.current = [];
        runningRef.current = false;
        window.clearTimeout(watchdogRef.current);
        onDone?.();
      };
      // Watchdog: a throttled/paused compositor may never fire `finish`; never leave the title hidden.
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(settleBurst, s.frames * s.frame + 220);
      if (last) {
        last.onfinish = settleBurst;
      }
    },
    [stop]
  );

  useLayoutEffect(() => {
    if (shown.from === null) return;
    const id = shown.id;
    const settle = () => setShown((s) => (s.id === id ? { ...s, from: null } : s));
    if (prefersReducedMotion()) {
      settle();
      return;
    }
    burst(true, settle);
  }, [shown.from, shown.id, burst]);

  useEffect(() => {
    if (!burstOnMount || prefersReducedMotion()) return;
    const frame = window.requestAnimationFrame(() => burst(false));
    return () => window.cancelAnimationFrame(frame);
  }, [burstOnMount, burst]);

  // Idle bursts while visible on screen and tab active
  useEffect(() => {
    const layers = layersRef.current;
    if ((trigger !== 'idle' && trigger !== 'both') || !layers) return;

    let onScreen = false;
    let timer: number | undefined;

    const schedule = (delayMs: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!document.hidden && !runningRef.current && !prefersReducedMotion()) {
          burst(false);
        }
        schedule(IDLE_MIN_MS + Math.random() * IDLE_SPREAD_MS);
      }, delayMs);
    };

    const sync = () => {
      if (onScreen && !document.hidden) {
        if (timer === undefined) {
          schedule(FIRST_IDLE_MS + Math.random() * 2600);
        }
      } else {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? false;
      sync();
    });
    io.observe(layers);
    document.addEventListener('visibilitychange', sync);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.clearTimeout(timer);
    };
  }, [trigger, burst]);

  // Subtle interactive directional shadow contour (no boxes, pure glyph contrast)
  useEffect(() => {
    if (!interactiveShadow || prefersReducedMotion()) return;
    const el = rootRef.current;
    if (!el) return;

    let raf = 0;
    let curX = 0;
    let curY = 2;
    let goalX = 0;
    let goalY = 2;

    const step = () => {
      raf = 0;
      if (document.hidden) return;
      curX += (goalX - curX) * 0.14;
      curY += (goalY - curY) * 0.14;
      el.style.setProperty('--sx', `${curX.toFixed(2)}px`);
      el.style.setProperty('--sy', `${curY.toFixed(2)}px`);
      if (Math.abs(goalX - curX) > 0.08 || Math.abs(goalY - curY) > 0.08) {
        raf = window.requestAnimationFrame(step);
      }
    };

    const onMove = (e: globalThis.PointerEvent) => {
      if (e.pointerType !== 'mouse' || document.hidden) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 360) {
        goalX = Math.max(-7, Math.min(7, (-dx / 240) * 6));
        goalY = Math.max(-4, Math.min(8, 2 + (-dy / 240) * 5));
      } else {
        goalX = 0;
        goalY = 2;
      }
      if (!raf) raf = window.requestAnimationFrame(step);
    };

    const onLeave = () => {
      goalX = 0;
      goalY = 2;
      if (!raf) raf = window.requestAnimationFrame(step);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [interactiveShadow]);

  useEffect(() => stop, [stop]);

  const onPointer = (e: PointerEvent) => {
    if (trigger !== 'hover' && trigger !== 'both') return;
    const isMouse = e.pointerType === 'mouse';
    if ((e.type === 'pointerenter') !== isMouse || runningRef.current || prefersReducedMotion()) {
      return;
    }
    burst(false);
  };

  return (
    <Root
      ref={rootRef as React.RefObject<never>}
      className={`glitch-text${interactiveShadow ? ' glitch-text--shadow' : ''} ${className}`.trim()}
      onPointerEnter={onPointer}
      onPointerDown={onPointer}
      style={
        {
          '--glitch-accent': accent,
          '--glitch-cyan': secondaryAccent,
        } as CSSProperties
      }
    >
      <span className="visually-hidden">{text}</span>
      <span aria-hidden="true" className="glitch-text__stack" ref={layersRef}>
        <span className="glitch-text__layer glitch-text__ghost" data-layer="channel" style={{ color: 'var(--glitch-accent)' }}>
          <LayerText from={shown.from} to={shown.to} />
        </span>
        <span className="glitch-text__layer glitch-text__ghost" data-layer="channel" style={{ color: 'var(--glitch-cyan)' }}>
          <LayerText from={shown.from} to={shown.to} />
        </span>
        <span className="glitch-text__layer" data-layer="base">
          <LayerText from={shown.from} to={shown.to} />
        </span>
        {BAND_IDS.map((id) => (
          <span className="glitch-text__layer glitch-text__ghost" data-layer="band" key={id}>
            <LayerText from={shown.from} to={shown.to} />
          </span>
        ))}
      </span>
    </Root>
  );
};
