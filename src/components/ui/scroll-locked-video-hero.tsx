import React, { useEffect, useRef, useState } from 'react';

export interface MetroHeroProps {
  /** Frame base path without trailing slash, e.g. /media/metro-frames/desktop */
  framesBase?: string;
  mobileFramesBase?: string;
  desktopFrameCount?: number;
  mobileFrameCount?: number;
  posterSrc?: string;
  title?: string;
  scrollHint?: string;
  scrollSubHint?: string;
  tagline?: string;
  signature?: { name: string; url: string } | false;
  /** Total input distance (px) needed to scrub the full sequence. */
  scrubDistance?: number;
  touchScrubDistance?: number;
  /** Extra scroll distance past 100% before unlocking and entering the site. */
  unlockAfterEndPx?: number;
  canUnlock?: boolean;
  fastForward?: boolean;
  onCueClick?: () => void;
  onUnlock?: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  ariaBusy?: boolean;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const DEFAULT_DESKTOP_FRAMES_BASE = '/media/metro-frames/desktop';
const DEFAULT_MOBILE_FRAMES_BASE = '/media/metro-frames/mobile';
const DEFAULT_DESKTOP_COUNT = 64;
const DEFAULT_MOBILE_COUNT = 48;
const DEFAULT_POSTER = '/media/metro-entry-poster.jpg';
const DEFAULT_SIGNATURE = {
  name: 'tonivecher.online',
  url: 'https://radio.tonivecher.online',
};
const SANS =
  'var(--font-display, "Aeonik", "Aeonik-Fallback", "Manrope", -apple-system, BlinkMacSystemFont, sans-serif)';

const COL_BG = '#120e0b';
const COL_TEXT = '#efe3d2';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function frameUrl(base: string, index: number): string {
  const num = String(index + 1).padStart(3, '0');
  return `${base}/f${num}.webp`;
}

/**
 * Unikorns-style cover crop onto a 2D canvas (object-fit: cover equivalent).
 */
function drawImageProp(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  offsetX = 0.5,
  offsetY = 0.5
): void {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih || !w || !h) return;

  const ox = clamp(offsetX, 0, 1);
  const oy = clamp(offsetY, 0, 1);

  const r = Math.min(w / iw, h / ih);
  let nw = iw * r;
  let nh = ih * r;
  let ar = 1;

  if (nw < w) ar = w / nw;
  if (Math.abs(ar - 1) < 1e-14 && nh < h) ar = h / nh;
  nw *= ar;
  nh *= ar;

  const cw = Math.min(iw, iw / (nw / w));
  const ch = Math.min(ih, ih / (nh / h));
  const cx = Math.max(0, (iw - cw) * ox);
  const cy = Math.max(0, (ih - ch) * oy);

  ctx.drawImage(img, cx, cy, cw, ch, x, y, w, h);
}

/**
 * Build progressive hydration order:
 * 1) frame 0 and final/reduced-motion frame first for instant first paint,
 * 2) coarse stride-4 keyframes for immediate smooth scrubbing,
 * 3) remaining intermediate frames in order.
 */
function buildLoadOrder(count: number): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  const push = (idx: number) => {
    if (idx >= 0 && idx < count && !seen.has(idx)) {
      seen.add(idx);
      order.push(idx);
    }
  };

  push(0);
  push(Math.round((count - 1) * 0.92));
  push(count - 1);
  for (let i = 0; i < count; i += 4) push(i);
  for (let i = 2; i < count; i += 4) push(i);
  for (let i = 0; i < count; i += 1) push(i);
  return order;
}

export default function MetroHero({
  framesBase = DEFAULT_DESKTOP_FRAMES_BASE,
  mobileFramesBase = DEFAULT_MOBILE_FRAMES_BASE,
  desktopFrameCount = DEFAULT_DESKTOP_COUNT,
  mobileFrameCount = DEFAULT_MOBILE_COUNT,
  posterSrc = DEFAULT_POSTER,
  title = 'ВАГОН 4:20',
  scrollHint = 'ПРОКРУТИ ВНИЗ',
  scrollSubHint = 'Листай вниз, чтобы открыть двери',
  tagline = 'Твоя остановка. Двери открыты.',
  signature = DEFAULT_SIGNATURE,
  scrubDistance = 1700,
  touchScrubDistance = 360,
  unlockAfterEndPx = 90,
  canUnlock = true,
  fastForward = false,
  onCueClick,
  onUnlock,
  onKeyDown,
  ariaBusy,
  children,
  className,
  style,
}: MetroHeroProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const taglineRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const [seqConfig] = useState(() => {
    const isMobile =
      typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches;
    return isMobile
      ? { base: mobileFramesBase, count: mobileFrameCount, isMobile: true }
      : { base: framesBase, count: desktopFrameCount, isMobile: false };
  });

  const canUnlockRef = useRef(canUnlock);
  canUnlockRef.current = canUnlock;
  const fastForwardRef = useRef(fastForward);
  fastForwardRef.current = fastForward;
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;
  const wakeFrameRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (fastForward) {
      wakeFrameRef.current();
    }
  }, [fastForward]);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const section = sectionRef.current;
    if (!canvasEl || !section) return;
    const canvas: HTMLCanvasElement = canvasEl;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const frameCount = seqConfig.count;
    const frames: Array<HTMLImageElement | null> = new Array(frameCount).fill(null);
    let disposed = false;
    let rafId = 0;
    let targetProgress = reduceMotion ? 0.92 : 0;
    let currentProgress = reduceMotion ? 0.92 : 0;
    let overScrollPx = 0;
    let unlocked = false;
    let hasStartedScrolling = false;
    let locked = false;
    let lockedScrollY = 0;
    let touchStartY = 0;
    let lastDrawnIndex = -1;
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let needsRedraw = true;

    const findNearestReady = (desired: number): number => {
      if (frames[desired]) return desired;
      for (let delta = 1; delta < frameCount; delta += 1) {
        const right = desired + delta;
        if (right < frameCount && frames[right]) return right;
        const left = desired - delta;
        if (left >= 0 && frames[left]) return left;
      }
      return -1;
    };

    const drawFrameIndex = (desired: number, force = false) => {
      if (!cssW || !cssH) return;
      const idx = findNearestReady(desired);
      if (idx === -1) return;
      if (!force && idx === lastDrawnIndex && !needsRedraw) return;
      const img = frames[idx];
      if (!img) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawImageProp(ctx, img, 0, 0, cssW, cssH);
      lastDrawnIndex = idx;
      needsRedraw = false;
    };

    const syncCanvasSize = () => {
      const nextW = canvas.clientWidth || window.innerWidth;
      const nextH = canvas.clientHeight || window.innerHeight;
      // Source WebP frames are 1280px/720px; capping DPR at 1.25 avoids 8MP Retina software blits.
      const nextDpr = Math.max(1, Math.min(1.25, window.devicePixelRatio || 1));
      const bufW = Math.max(1, Math.round(nextW * nextDpr));
      const bufH = Math.max(1, Math.round(nextH * nextDpr));
      if (canvas.width !== bufW) canvas.width = bufW;
      if (canvas.height !== bufH) canvas.height = bufH;
      cssW = nextW;
      cssH = nextH;
      dpr = nextDpr;
      needsRedraw = true;
      const desired = Math.round(clamp(currentProgress, 0, 1) * (frameCount - 1));
      drawFrameIndex(desired, true);
    };

    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(canvas);

    // Progressive WebP ImageSequence loader: fetch frame 0 immediately, then hydrate remaining
    // frames with bounded concurrency after a brief yield so API state and <audio> are never starved.
    const order = buildLoadOrder(frameCount);
    let cursor = 0;
    let firstPainted = false;
    const loadImage = (idx: number): Promise<void> =>
      new Promise((resolve) => {
        if (disposed) {
          resolve();
          return;
        }
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (disposed) {
            resolve();
            return;
          }
          frames[idx] = img;
          if (!firstPainted) {
            firstPainted = true;
            setReady(true);
            needsRedraw = true;
            const desired = Math.round(clamp(currentProgress, 0, 1) * (frameCount - 1));
            drawFrameIndex(desired, true);
          } else {
            const desired = Math.round(clamp(currentProgress, 0, 1) * (frameCount - 1));
            if (Math.abs(idx - desired) < Math.abs(lastDrawnIndex - desired) || lastDrawnIndex === -1) {
              needsRedraw = true;
              if (reduceMotion) {
                drawFrameIndex(desired, true);
              } else {
                scheduleFrame();
              }
            }
          }
          resolve();
        };
        img.onerror = () => resolve();
        img.src = frameUrl(seqConfig.base, idx);
      });

    let hydrateTimer = 0;
    const startHydration = async () => {
      if (order.length > 0) {
        const firstIdx = order[cursor++];
        await loadImage(firstIdx);
      }
      if (disposed) return;
      hydrateTimer = window.setTimeout(() => {
        if (disposed) return;
        const concurrency = seqConfig.isMobile ? 2 : 3;
        const workers = Array.from({ length: concurrency }, async () => {
          while (!disposed && cursor < order.length) {
            const nextIdx = order[cursor++];
            await loadImage(nextIdx);
          }
        });
        void Promise.all(workers);
      }, 280);
    };
    void startHydration();

    function engageLock() {
      if (locked || typeof document === 'undefined') return;
      locked = true;
      lockedScrollY = window.scrollY;
      const b = document.body.style;
      b.position = 'fixed';
      b.top = `-${lockedScrollY}px`;
      b.left = '0';
      b.right = '0';
      b.width = '100%';
      b.height = '100%';
      b.overscrollBehavior = 'none';
    }

    function releaseLock() {
      if (!locked || typeof document === 'undefined') return;
      locked = false;
      const b = document.body.style;
      b.position = '';
      b.top = '';
      b.left = '';
      b.right = '';
      b.width = '';
      b.height = '';
      b.overscrollBehavior = '';
      window.scrollTo(0, 0);
    }

    engageLock();

    let lastAppliedProgress = -1;
    let touchActive = false;

    const scheduleFrame = () => {
      if (disposed || reduceMotion || rafId) return;
      rafId = requestAnimationFrame(frame);
    };
    wakeFrameRef.current = scheduleFrame;

    function addDelta(deltaY: number, distanceScale: number) {
      if (unlocked || fastForwardRef.current) return true;

      if (deltaY > 0 && targetProgress >= 0.99 && currentProgress >= 0.9) {
        if (canUnlockRef.current) {
          overScrollPx += deltaY;
          if (overScrollPx >= unlockAfterEndPx && !unlocked) {
            unlocked = true;
            onUnlockRef.current?.();
          }
        }
        return true;
      }

      if (deltaY < 0) {
        overScrollPx = 0;
      }

      const next = clamp(targetProgress + deltaY / distanceScale, 0, 1);
      targetProgress = next;
      if (targetProgress > 0.001) hasStartedScrolling = true;
      scheduleFrame();
      return true;
    }

    const isInteractiveTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement && Boolean(target.closest('button, a, input'));

    const onWheel = (e: WheelEvent) => {
      addDelta(e.deltaY, scrubDistance);
      e.preventDefault();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (isInteractiveTarget(e.target)) {
        touchActive = false;
        return;
      }
      touchActive = true;
      touchStartY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touchActive) return;
      const y = e.touches[0]?.clientY ?? touchStartY;
      const deltaY = touchStartY - y;
      touchStartY = y;
      addDelta(deltaY, touchScrubDistance);
      e.preventDefault();
    };
    const onTouchEnd = () => {
      if (!touchActive) return;
      touchActive = false;
      if (!unlocked && canUnlockRef.current && targetProgress >= 0.96) {
        unlocked = true;
        onUnlockRef.current?.();
      }
    };

    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        addDelta(280, scrubDistance);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        addDelta(-280, scrubDistance);
      } else if (e.key === ' ') {
        const tgt = e.target;
        if (tgt instanceof HTMLElement && tgt.closest('button, a, input')) {
          return;
        }
        e.preventDefault();
        addDelta(280, scrubDistance);
      }
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onWindowKeyDown);
    section.addEventListener('touchstart', onTouchStart, { passive: true });
    section.addEventListener('touchmove', onTouchMove, { passive: false });
    section.addEventListener('touchend', onTouchEnd, { passive: true });

    function applyProgressStyles(progress: number) {
      const scale = 1 + progress * 0.055;
      canvas.style.transform = `scale(${scale.toFixed(4)})`;

      if (titleRef.current) {
        const t = 1 - clamp(progress / 0.35, 0, 1);
        titleRef.current.style.opacity = t.toFixed(3);
        titleRef.current.style.transform = `translate3d(0, ${((1 - t) * -22).toFixed(1)}px, 0) scale(${(0.96 + t * 0.04).toFixed(4)})`;
      }
      if (hintRef.current) {
        const hintOpacity = hasStartedScrolling
          ? 1 - clamp(progress / 0.16, 0, 1)
          : 1;
        hintRef.current.style.opacity = hintOpacity.toFixed(3);
      }
      if (taglineRef.current) {
        const t = clamp((progress - 0.82) / 0.18, 0, 1);
        taglineRef.current.style.opacity = t.toFixed(3);
        taglineRef.current.style.transform = `translate3d(0, ${((1 - t) * 18).toFixed(1)}px, 0) scale(${(0.97 + t * 0.03).toFixed(4)})`;
      }
      if (progressBarRef.current) {
        progressBarRef.current.style.transform = `scaleX(${progress.toFixed(4)})`;
      }
    }

    function frame() {
      rafId = 0;
      if (disposed) return;

      const goal = fastForwardRef.current ? 1 : targetProgress;
      const step = fastForwardRef.current ? 0.16 : 0.18;
      const diff = goal - currentProgress;
      if (Math.abs(diff) < 0.0005) {
        currentProgress = goal;
      } else {
        currentProgress += diff * step;
      }

      const desiredIndex = Math.round(clamp(currentProgress, 0, 1) * (frameCount - 1));
      drawFrameIndex(desiredIndex);

      if (Math.abs(currentProgress - lastAppliedProgress) > 0.0002) {
        lastAppliedProgress = currentProgress;
        applyProgressStyles(currentProgress);
      }

      if (Math.abs(goal - currentProgress) >= 0.0005 || needsRedraw) {
        scheduleFrame();
      }
    }

    if (!reduceMotion) {
      applyProgressStyles(currentProgress);
      scheduleFrame();
    }

    return () => {
      disposed = true;
      wakeFrameRef.current = () => {};
      window.clearTimeout(hydrateTimer);
      ro.disconnect();
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onWindowKeyDown);
      section.removeEventListener('touchstart', onTouchStart);
      section.removeEventListener('touchmove', onTouchMove);
      section.removeEventListener('touchend', onTouchEnd);
      cancelAnimationFrame(rafId);
      releaseLock();
    };
  }, [scrubDistance, touchScrubDistance, unlockAfterEndPx, seqConfig]);

  return (
    <div
      ref={sectionRef}
      tabIndex={-1}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-labelledby="moscow-intro-title"
      aria-busy={ariaBusy}
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        height: '100dvh',
        width: '100%',
        overflow: 'hidden',
        background: `${COL_BG} url(${posterSrc}) center / cover no-repeat`,
        touchAction: 'none',
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          opacity: ready ? 1 : 0,
          transformOrigin: 'center center',
          willChange: 'transform',
          transition: 'opacity 0.45s cubic-bezier(0.33, 1, 0.68, 1)',
          touchAction: 'none',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(16,11,8,0.35), rgba(16,11,8,0) 30%, rgba(16,11,8,0.15) 70%, rgba(16,11,8,0.55))',
          pointerEvents: 'none',
        }}
      />

      <div
        ref={titleRef}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 6%',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <h1
          id="moscow-intro-title"
          className="moscow-intro__title-text num-tabular"
          style={{
            margin: 0,
            fontFamily: SANS,
            fontWeight: 800,
            fontSize: 'clamp(30px, 7vw, 96px)',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: COL_TEXT,
            display: 'inline-block',
            willChange: 'transform, opacity',
          }}
        >
          {title.includes(':')
            ? title.split(':').map((part, idx, arr) => (
                <React.Fragment key={idx}>
                  {part}
                  {idx < arr.length - 1 && (
                    <span className="moscow-intro__title-colon" aria-hidden="true">
                      :
                    </span>
                  )}
                </React.Fragment>
              ))
            : title}
        </h1>
      </div>

      {tagline && (
        <div
          ref={taglineRef}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 8%',
            textAlign: 'center',
            opacity: 0,
            pointerEvents: 'none',
          }}
        >
          <span
            className="moscow-intro__tagline-text"
            style={{
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: 'clamp(20px, 3.4vw, 40px)',
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
              color: COL_TEXT,
            }}
          >
            {tagline}
          </span>
        </div>
      )}

      <div
        ref={hintRef}
        className="moscow-intro__scroll-cue"
        style={{
          fontFamily: SANS,
        }}
      >
        {onCueClick ? (
          <button
            type="button"
            className="moscow-intro__scroll-pill moscow-intro__scroll-pill--interactive"
            onClick={onCueClick}
          >
            <span className="moscow-intro__scroll-title num-tabular">{scrollHint}</span>
            {scrollSubHint && (
              <span className="moscow-intro__scroll-sub">{scrollSubHint}</span>
            )}
          </button>
        ) : (
          <div className="moscow-intro__scroll-pill">
            <span className="moscow-intro__scroll-title num-tabular">{scrollHint}</span>
            {scrollSubHint && (
              <span className="moscow-intro__scroll-sub">{scrollSubHint}</span>
            )}
          </div>
        )}
        <svg
          width="18"
          height="24"
          viewBox="0 0 18 24"
          className="moscow-intro__scroll-arrow"
          aria-hidden="true"
        >
          <path
            d="M9 2 L9 18 M3.5 13 L9 18.5 L14.5 13 M5.5 18.5 L9 22 L12.5 18.5"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Thin progress line — fills as the sequence advances. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          background: 'rgba(239, 227, 210, 0.14)',
        }}
      >
        <div
          ref={progressBarRef}
          style={{
            height: '100%',
            width: '100%',
            background:
              'linear-gradient(90deg, rgba(231, 187, 148, 0.55), rgba(239, 227, 210, 0.96))',
            transform: 'scaleX(0)',
            transformOrigin: 'left center',
          }}
        />
      </div>

      {signature && (
        <span
          className="moscow-intro__signature"
          style={{
            position: 'absolute',
            right: 'clamp(12px, 2.5vw, 24px)',
            bottom: 'calc(clamp(12px, 2vw, 18px) + env(safe-area-inset-bottom, 0px))',
            fontFamily: SANS,
            fontWeight: 500,
            fontSize: 'clamp(11px, 1.4vw, 13px)',
            letterSpacing: '0.01em',
            color: 'rgba(223, 211, 192, 0.6)',
            zIndex: 2,
          }}
        >
          <a
            href={signature.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'rgba(223, 211, 192, 0.6)',
              textDecoration: 'none',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
              e.currentTarget.style.color = COL_TEXT;
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
              e.currentTarget.style.color = 'rgba(223, 211, 192, 0.6)';
            }}
          >
            {signature.name}
          </a>
        </span>
      )}

      {children}
    </div>
  );
}
