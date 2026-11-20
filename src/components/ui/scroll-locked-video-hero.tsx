import React, { useEffect, useRef, useState } from 'react';

export interface MetroHeroProps {
  videoSrc?: string;
  mobileVideoSrc?: string;
  posterSrc?: string;
  title?: string;
  scrollHint?: string;
  scrollSubHint?: string;
  tagline?: string;
  signature?: { name: string; url: string } | false;
  /** Total input distance (px) needed to scrub the full video. */
  scrubDistance?: number;
  touchScrubDistance?: number;
  /** Extra scroll distance past 100% before unlocking and entering the site. */
  unlockAfterEndPx?: number;
  canUnlock?: boolean;
  fastForward?: boolean;
  onUnlock?: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  ariaBusy?: boolean;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const DEFAULT_VIDEO = '/media/metro-entry.mp4';
const DEFAULT_MOBILE_VIDEO = '/media/metro-entry-mobile.mp4?v=2';
const DEFAULT_POSTER = '/media/metro-entry-poster.jpg';
const DEFAULT_SIGNATURE = {
  name: 'tonivecher.online',
  url: 'https://radio.tonivecher.online',
};
const SANS =
  "var(--font-display, 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif)";

const COL_BG = '#120e0b';
const COL_TEXT = '#efe3d2';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export default function MetroHero({
  videoSrc = DEFAULT_VIDEO,
  mobileVideoSrc = DEFAULT_MOBILE_VIDEO,
  posterSrc = DEFAULT_POSTER,
  title = 'ВАГОН 4:20',
  scrollHint = 'ПРОКРУТИ ВНИЗ',
  scrollSubHint = 'Листай вниз, чтобы открыть двери',
  tagline = 'Твоя остановка. Двери открыты.',
  signature = DEFAULT_SIGNATURE,
  scrubDistance = 2100,
  touchScrubDistance = 950,
  unlockAfterEndPx = 220,
  canUnlock = true,
  fastForward = false,
  onUnlock,
  onKeyDown,
  ariaBusy,
  children,
  className,
  style,
}: MetroHeroProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const taglineRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const [sourceUrl] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches
      ? mobileVideoSrc || videoSrc
      : videoSrc
  );
  const [blobUrl, setBlobUrl] = useState('');
  const [blobFailed, setBlobFailed] = useState(false);

  const canUnlockRef = useRef(canUnlock);
  canUnlockRef.current = canUnlock;
  const fastForwardRef = useRef(fastForward);
  fastForwardRef.current = fastForward;
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;

  // Preload the MP4 once into a RAM Blob (0ms seek latency) without triggering a duplicate <video src> download.
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setBlobFailed(false);
    fetch(sourceUrl, { signal: controller.signal })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('Fetch failed'))))
      .then((blob) => {
        if (controller.signal.aborted || !blob.size) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBlobFailed(true);
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [sourceUrl]);

  useEffect(() => {
    const videoEl = videoRef.current;
    const section = sectionRef.current;
    if (!videoEl || !section) return;
    const video: HTMLVideoElement = videoEl;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let duration = Number.isFinite(video.duration) ? video.duration : 0;
    let rafId = 0;
    let targetProgress = 0;
    let currentProgress = 0;
    let overScrollPx = 0;
    let unlocked = false;
    let hasStartedScrolling = false;
    let isSeeking = false;
    let pendingTime: number | null = null;
    let locked = false;
    let lockedScrollY = 0;
    let touchStartY = 0;

    const onLoadedData = () => {
      duration = Number.isFinite(video.duration) ? video.duration : 0;
      setReady(true);
      if (reduceMotion && duration > 0) {
        video.currentTime = duration * 0.92;
      }
    };
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('loadedmetadata', onLoadedData);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      onLoadedData();
    }

    // Silent play-then-immediately-pause on mount to kick off frame decoding on iOS Safari.
    const kickstartLoad = () => {
      const p = video.play();
      if (p && typeof p.then === 'function') {
        p.then(() => video.pause()).catch(() => {});
      } else {
        video.pause();
      }
    };
    kickstartLoad();

    const onSeeked = () => {
      isSeeking = false;
      if (pendingTime !== null) {
        const t = pendingTime;
        pendingTime = null;
        isSeeking = true;
        try {
          video.currentTime = t;
        } catch {
          isSeeking = false;
        }
      }
    };
    video.addEventListener('seeked', onSeeked);

    function seekTo(t: number) {
      if (isSeeking) {
        pendingTime = t;
        return;
      }
      isSeeking = true;
      try {
        video.currentTime = t;
      } catch {
        isSeeking = false;
      }
    }

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

    function addDelta(deltaY: number, distanceScale: number) {
      if (unlocked || fastForwardRef.current) return true;

      // Once the video has reached the end and the tagline is in focus, continued forward
      // pushing accumulates towards unlocking the page into the radio site.
      if (deltaY > 0 && targetProgress >= 0.995 && currentProgress >= 0.94) {
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
      return true;
    }

    const onWheel = (e: WheelEvent) => {
      addDelta(e.deltaY, scrubDistance);
      e.preventDefault();
    };

    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? touchStartY;
      const deltaY = touchStartY - y;
      touchStartY = y;
      addDelta(deltaY, touchScrubDistance);
      e.preventDefault();
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
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('keydown', onWindowKeyDown);
    section.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    section.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });

    function frame() {
      if (fastForwardRef.current) {
        targetProgress = 1;
        currentProgress += (1 - currentProgress) * 0.14;
      } else {
        currentProgress += (targetProgress - currentProgress) * 0.16;
      }

      const liveDuration =
        duration > 0
          ? duration
          : Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : 0;
      if (liveDuration > 0 && currentProgress < 0.997) {
        duration = liveDuration;
        const targetTime = clamp(currentProgress * liveDuration, 0, Math.max(0, liveDuration - 0.04));
        if (Math.abs(video.currentTime - targetTime) > 0.016) {
          seekTo(targetTime);
        }
      }

      if (videoRef.current) {
        const scale = 1 + currentProgress * 0.055;
        videoRef.current.style.transform = `scale(${scale.toFixed(4)})`;
      }
      if (titleRef.current) {
        const t = 1 - clamp(currentProgress / 0.35, 0, 1);
        titleRef.current.style.opacity = t.toFixed(3);
        titleRef.current.style.transform = `translate3d(0, ${((1 - t) * -22).toFixed(1)}px, 0) scale(${(0.96 + t * 0.04).toFixed(4)})`;
      }
      if (hintRef.current) {
        const hintOpacity = hasStartedScrolling
          ? 1 - clamp(currentProgress / 0.16, 0, 1)
          : 1;
        hintRef.current.style.opacity = hintOpacity.toFixed(3);
      }
      if (taglineRef.current) {
        const t = clamp((currentProgress - 0.82) / 0.18, 0, 1);
        taglineRef.current.style.opacity = t.toFixed(3);
        taglineRef.current.style.transform = `translate3d(0, ${((1 - t) * 18).toFixed(1)}px, 0) scale(${(0.97 + t * 0.03).toFixed(4)})`;
      }
      if (progressBarRef.current) {
        progressBarRef.current.style.transform = `scaleX(${currentProgress.toFixed(4)})`;
      }

      rafId = requestAnimationFrame(frame);
    }

    if (!reduceMotion) {
      rafId = requestAnimationFrame(frame);
    }

    return () => {
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('loadedmetadata', onLoadedData);
      video.removeEventListener('seeked', onSeeked);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onWindowKeyDown);
      section.removeEventListener('touchstart', onTouchStart, true);
      section.removeEventListener('touchmove', onTouchMove, true);
      cancelAnimationFrame(rafId);
      releaseLock();
    };
  }, [scrubDistance, touchScrubDistance, unlockAfterEndPx, blobUrl]);

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
        background: COL_BG,
        touchAction: 'none',
        ...style,
      }}
    >
      <video
        ref={videoRef}
        src={blobUrl || (blobFailed ? sourceUrl : undefined)}
        poster={posterSrc}
        muted
        playsInline
        preload="auto"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: ready ? 1 : 0.96,
          transformOrigin: 'center center',
          willChange: 'transform',
          transition: 'opacity 0.6s ease',
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
          className="moscow-intro__title-text"
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
        <div className="moscow-intro__scroll-pill">
          <span className="moscow-intro__scroll-title">{scrollHint}</span>
          {scrollSubHint && (
            <span className="moscow-intro__scroll-sub">{scrollSubHint}</span>
          )}
        </div>
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

      {/* Thin progress line — fills as the video advances. */}
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
          style={{
            position: 'absolute',
            right: 'clamp(12px, 2.5vw, 24px)',
            bottom: 'clamp(10px, 2vw, 18px)',
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
