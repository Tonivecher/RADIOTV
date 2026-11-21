import React, {
  type CSSProperties,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export type GlitchTextTrigger = 'idle' | 'hover' | 'change' | 'both';
export type GlitchTextIntensity = 'subtle' | 'medium' | 'strong';
type GlitchVariant = 'slice-shear' | 'glyph-scramble' | 'scan-tear' | 'double-echo' | 'signal-drop';

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
  /** Cycle through varied expressive glitch styles (slices, scramble, scan-tear, stereo echo, signal-drop). */
  variety?: boolean;
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
  medium: { bands: 4, shift: 0.12, split: 3.5, frames: 6, frame: 48 },
  strong: { bands: 5, shift: 0.22, split: 6.5, frames: 8, frame: 44 },
};

const VARIANTS: readonly GlitchVariant[] = [
  'slice-shear',
  'glyph-scramble',
  'scan-tear',
  'double-echo',
  'signal-drop',
];

const SCRAMBLE_GLYPHS = '012345789∆∇◊/#_+:=░X';
const MAX_BANDS = 5;
const BAND_IDS = Array.from({ length: MAX_BANDS }, (_, i) => `b-${i}`);
const HOLD = 'steps(1, end)';
const STILL_CHANCE = 0.22;

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
  return round(sign * (0.34 + 0.66 * Math.random()) * max);
};

const bandPath = (frames: number, shift: number, forceMove: boolean) =>
  Array.from({ length: frames }, (_, f) => {
    if (f === frames - 1) return 0;
    const x = jump(shift);
    return f === 0 && forceMove && x === 0 ? round(shift * 0.72) : x;
  });

const scrambleWord = (source: string, ratio: number): string => {
  const chars = [...source];
  const indices: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== ' ') indices.push(i);
  }
  const replaceCount = Math.max(1, Math.min(indices.length, Math.round(indices.length * ratio)));
  for (let k = 0; k < replaceCount; k++) {
    const pickIdx = Math.floor(Math.random() * indices.length);
    const charPos = indices.splice(pickIdx, 1)[0];
    if (charPos === undefined) break;
    chars[charPos] = SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)] ?? '#';
  }
  return chars.join('');
};

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
 * Expressive signal glitch text with varied analog/digital distortion modes:
 * slice-shear, matrix glyph-scramble, vertical scan-tear, stereo double-echo, and signal-drop.
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
  variety = false,
}) => {
  const rootRef = useRef<HTMLElement>(null);
  const layersRef = useRef<HTMLSpanElement>(null);
  const animsRef = useRef<Animation[]>([]);
  const runningRef = useRef(false);
  const watchdogRef = useRef<number | undefined>(undefined);
  const scrambleTimerRef = useRef<number | undefined>(undefined);
  const echoTimerRef = useRef<number | undefined>(undefined);
  const lastVariantRef = useRef<GlitchVariant | null>(null);
  const intensityRef = useRef(intensity);
  const varietyRef = useRef(variety);
  const textRef = useRef(text);
  intensityRef.current = intensity;
  varietyRef.current = variety;
  textRef.current = text;

  const [shown, setShown] = useState<{ from: string | null; to: string; id: number }>({
    from: null,
    to: text,
    id: 0,
  });
  const [scrambledTo, setScrambledTo] = useState<string | null>(null);

  if (shown.to !== text) {
    setShown({ from: shown.to, to: text, id: shown.id + 1 });
  }

  const clearTimers = useCallback(() => {
    window.clearTimeout(watchdogRef.current);
    window.clearInterval(scrambleTimerRef.current);
    window.clearTimeout(echoTimerRef.current);
    watchdogRef.current = undefined;
    scrambleTimerRef.current = undefined;
    echoTimerRef.current = undefined;
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    for (const a of animsRef.current) {
      a.cancel();
    }
    animsRef.current = [];
    runningRef.current = false;
    setScrambledTo(null);
  }, [clearTimers]);

  const pickVariant = useCallback((): GlitchVariant => {
    if (!varietyRef.current) return 'slice-shear';
    const pool = VARIANTS.filter((v) => v !== lastVariantRef.current);
    const chosen = pool[Math.floor(Math.random() * pool.length)] ?? 'slice-shear';
    lastVariantRef.current = chosen;
    return chosen;
  }, []);

  const burst = useCallback(
    (swap: boolean, onDone?: () => void, forcedVariant?: GlitchVariant, allowEcho = true) => {
      const layers = layersRef.current;
      if (!layers || typeof layers.animate !== 'function') {
        onDone?.();
        return;
      }
      stop();

      const s = INTENSITY[intensityRef.current];
      const variant = swap ? 'slice-shear' : (forcedVariant ?? pickVariant());
      const frameCount =
        variant === 'double-echo'
          ? Math.max(6, s.frames - 1)
          : variant === 'scan-tear'
            ? Math.max(7, s.frames)
            : s.frames;
      const frameMs = variant === 'glyph-scramble' ? Math.max(38, s.frame) : s.frame;
      const duration = frameCount * frameMs;

      const opts: KeyframeAnimationOptions = {
        duration,
        fill: 'none',
      };
      const anims: Animation[] = [];
      const run = (el: Element, frames: Keyframe[]) => {
        anims.push(el.animate(held(frames), opts));
      };

      const base = layers.querySelector('[data-layer="base"]');
      const bands = layers.querySelectorAll<HTMLElement>('[data-layer="band"]');
      const channels = layers.querySelectorAll<HTMLElement>('[data-layer="channel"]');

      // Optional brief character scramble for matrix-style modes (never touches sr-only text)
      if (!swap && (variant === 'glyph-scramble' || variant === 'signal-drop')) {
        const ratio = variant === 'glyph-scramble' ? 0.36 : 0.2;
        const sourceWord = textRef.current;
        let step = 0;
        const maxSteps = Math.max(3, frameCount - 2);
        setScrambledTo(scrambleWord(sourceWord, ratio));
        scrambleTimerRef.current = window.setInterval(() => {
          step += 1;
          if (step >= maxSteps) {
            window.clearInterval(scrambleTimerRef.current);
            scrambleTimerRef.current = undefined;
            setScrambledTo(null);
          } else {
            const decay = 1 - (step / maxSteps) * 0.45;
            setScrambledTo(scrambleWord(sourceWord, ratio * decay));
          }
        }, frameMs);
      }

      // Base layer animation per variant (always stays visible so title never flashes blank)
      if (base) {
        run(
          base,
          Array.from({ length: frameCount }, (_, f) => {
            if (f === frameCount - 1) {
              return { opacity: 1, transform: 'translate3d(0, 0, 0) skewX(0deg)', filter: 'none' };
            }
            if (variant === 'double-echo') {
              const jx = (f % 2 === 0 ? 1 : -1) * Math.round(1.5 + Math.random() * 2.5);
              const jy = f === 1 || f === 3 ? -1.5 : 1;
              const sk = f === 1 ? -5 : f === 3 ? 4 : 0;
              return {
                opacity: 0.82,
                transform: `translate3d(${jx}px, ${jy}px, 0) skewX(${sk}deg)`,
                filter: f === 1 || f === 3 ? 'brightness(1.22)' : 'none',
              };
            }
            if (variant === 'scan-tear') {
              return {
                opacity: 0.78,
                transform: `translate3d(${f % 3 === 1 ? -1.5 : 0}px, 0, 0)`,
                filter: f === Math.floor(frameCount / 2) ? 'brightness(1.26) contrast(1.12)' : 'none',
              };
            }
            if (variant === 'glyph-scramble') {
              const sk = f % 2 === 0 ? -3.5 : 3.5;
              return {
                opacity: 0.9,
                transform: `translate3d(${f % 2 === 0 ? -1 : 1}px, 0, 0) skewX(${sk}deg)`,
                filter: f === 1 ? 'brightness(1.18)' : 'none',
              };
            }
            if (variant === 'signal-drop') {
              return {
                opacity: f === 1 || f === 2 ? 0.56 : 0.78,
                transform: `translate3d(${f === 1 ? 3 : f === 2 ? -2 : 0}px, 0, 0)`,
                filter: 'none',
              };
            }
            return {
              opacity: swap ? 0.45 : 0.72,
              transform: `skewX(${f === 1 ? -4 : f === 3 ? 3 : 0}deg)`,
              filter: 'none',
            };
          })
        );
      }

      // Band slices per variant
      if (variant === 'scan-tear') {
        const sweepBand = bands[0];
        if (sweepBand) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          sweepBand.style.clipPath = '';
          run(
            sweepBand,
            Array.from({ length: frameCount }, (_, f) => {
              if (f === frameCount - 1) {
                return {
                  opacity: 0,
                  clipPath: 'inset(100% -24% 0% -24%)',
                  transform: 'translate3d(0, 0, 0)',
                  filter: 'none',
                };
              }
              const progress = f / Math.max(1, frameCount - 2);
              const bandTop = round(progress * 74);
              const bandBottom = round(Math.max(0, 100 - bandTop - 24));
              const shiftX = round(dir * s.shift * (0.75 + 0.55 * Math.sin(progress * Math.PI)));
              return {
                opacity: 1,
                clipPath: `inset(${bandTop}% -24% ${bandBottom}% -24%)`,
                transform: `translate3d(${shiftX}em, 0, 0) skewX(${dir * 7}deg)`,
                filter: 'brightness(1.3)',
              };
            })
          );
        }
        bands.forEach((band, i) => {
          if (i === 0 || i >= 3) return;
          const top = i === 1 ? 12 : 58;
          const bottom = i === 1 ? 66 : 16;
          band.style.clipPath = `inset(${top}% -22% ${bottom}% -22%)`;
          run(
            band,
            bandPath(frameCount, s.shift * 0.55, true).map((x) => ({
              opacity: x === 0 ? 0 : 0.9,
              transform: `translate3d(${x}em, 0, 0)`,
            }))
          );
        });
      } else if (variant === 'signal-drop') {
        const splitAt = 42 + Math.round(Math.random() * 18);
        const sign = Math.random() < 0.5 ? 1 : -1;
        bands.forEach((band, i) => {
          if (i >= 2) return;
          band.style.clipPath =
            i === 0
              ? `inset(-30% -24% ${100 - splitAt}% -24%)`
              : `inset(${splitAt}% -24% -30% -24%)`;
          const dir = i === 0 ? sign : -sign;
          run(
            band,
            Array.from({ length: frameCount }, (_, f) => {
              if (f === frameCount - 1) {
                return { opacity: 0, transform: 'translate3d(0, 0, 0)' };
              }
              const mag = f === 1 || f === 2 ? s.shift * 1.05 : f === 4 ? s.shift * 0.55 : s.shift * 0.2;
              return {
                opacity: 1,
                transform: `translate3d(${round(dir * mag)}em, ${i === 0 ? -1 : 1}px, 0)`,
              };
            })
          );
        });
      } else {
        const cuts = randomCuts(s.bands);
        const mover = Math.floor(Math.random() * s.bands);
        const shiftScale = variant === 'glyph-scramble' ? 0.65 : variant === 'double-echo' ? 0.85 : 1.08;
        bands.forEach((band, i) => {
          if (i >= s.bands) return;
          const top = i === 0 ? -40 : cuts[i];
          const bottom = i === s.bands - 1 ? -40 : round(100 - cuts[i + 1]);
          band.style.clipPath = `inset(${top}% -24% ${bottom}% -24%)`;
          run(
            band,
            bandPath(frameCount, s.shift * shiftScale, i === mover).map((x, f) => ({
              opacity: f === frameCount - 1 ? 0 : 1,
              transform:
                variant === 'slice-shear' && Math.abs(x) > s.shift * 0.5
                  ? `translate3d(${x}em, 0, 0) skewX(${x > 0 ? 7 : -7}deg)`
                  : `translate3d(${x}em, 0, 0)`,
            }))
          );
        });
      }

      // Chromatic RGB channel separation per variant
      const splitBoost =
        variant === 'double-echo'
          ? 1.55
          : variant === 'slice-shear'
            ? 1.25
            : variant === 'scan-tear'
              ? 1.15
              : 0.95;
      const offsets = Array.from({ length: frameCount }, () =>
        Math.max(1.5, round((0.45 + 0.55 * Math.random()) * s.split * splitBoost))
      );
      channels.forEach((channel, c) => {
        const dir = c === 0 ? -1 : 1;
        run(
          channel,
          offsets.map((d, f) => {
            if (f === frameCount - 1) {
              return { opacity: 0, transform: 'translate3d(0, 0, 0)' };
            }
            if (variant === 'double-echo') {
              const pulse = f % 2 === 0 ? 1 : 0.45;
              const yOff = dir * (1.8 + (f % 2) * 1.4);
              return {
                opacity: 0.92 * pulse,
                transform: `translate3d(${round(dir * d * pulse)}px, ${round(yOff)}px, 0) skewX(${dir * 9}deg) scaleX(1.035)`,
              };
            }
            const yOff = c === 0 ? -1.2 : 1.2;
            return {
              opacity: 0.9,
              transform: `translate3d(${round(dir * d)}px, ${yOff}px, 0)`,
            };
          })
        );
      });

      if (swap) {
        const half = Math.ceil(frameCount / 2);
        const flip = (selector: string, before: number) => {
          for (const el of layers.querySelectorAll(selector)) {
            run(
              el,
              Array.from({ length: frameCount }, (_, f) => ({
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
      const shouldEcho =
        !swap && allowEcho && varietyRef.current && (variant === 'signal-drop' || Math.random() < 0.28);

      const settleBurst = () => {
        if (animsRef.current !== anims) return;
        for (const a of anims) {
          a.cancel();
        }
        animsRef.current = [];
        runningRef.current = false;
        window.clearTimeout(watchdogRef.current);
        window.clearInterval(scrambleTimerRef.current);
        watchdogRef.current = undefined;
        scrambleTimerRef.current = undefined;
        setScrambledTo(null);
        onDone?.();

        if (shouldEcho && !document.hidden && !prefersReducedMotion()) {
          echoTimerRef.current = window.setTimeout(() => {
            echoTimerRef.current = undefined;
            if (!document.hidden && !runningRef.current && !prefersReducedMotion()) {
              burst(false, undefined, 'double-echo', false);
            }
          }, 95 + Math.round(Math.random() * 90));
        }
      };

      // Watchdog: a throttled/paused compositor may never fire `finish`; never leave the title hidden.
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(settleBurst, duration + 220);
      if (last) {
        last.onfinish = settleBurst;
      }
    },
    [stop, pickVariant]
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

    const firstDelay = variety ? 1600 : 2800;
    const minDelay = variety ? 3200 : 6500;
    const spreadDelay = variety ? 3200 : 6500;

    const schedule = (delayMs: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!document.hidden && !runningRef.current && !prefersReducedMotion()) {
          burst(false);
        }
        schedule(minDelay + Math.random() * spreadDelay);
      }, delayMs);
    };

    const sync = () => {
      if (onScreen && !document.hidden) {
        if (timer === undefined) {
          schedule(firstDelay + Math.random() * 1600);
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
  }, [trigger, variety, burst]);

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

  const displayTo = scrambledTo ?? shown.to;

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
        <span
          className="glitch-text__layer glitch-text__ghost"
          data-layer="channel"
          style={{ color: 'var(--glitch-accent)' }}
        >
          <LayerText from={shown.from} to={displayTo} />
        </span>
        <span
          className="glitch-text__layer glitch-text__ghost"
          data-layer="channel"
          style={{ color: 'var(--glitch-cyan)' }}
        >
          <LayerText from={shown.from} to={displayTo} />
        </span>
        <span className="glitch-text__layer" data-layer="base">
          <LayerText from={shown.from} to={displayTo} />
        </span>
        {BAND_IDS.map((id) => (
          <span className="glitch-text__layer glitch-text__ghost" data-layer="band" key={id}>
            <LayerText from={shown.from} to={displayTo} />
          </span>
        ))}
      </span>
    </Root>
  );
};
