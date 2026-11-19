import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'framer-motion';
import {
  interpolateAsciiProfile,
  resolveChannelAsciiProfile,
  resolveChannelPortalCopy,
} from '../constants/ascii';
import { AsciiDotsRenderer } from '../utils/asciiDotsRenderer';
import { GlitchText } from './living/GlitchText';
import '../styles/deep-portal.css';

export interface ChannelTransition {
  fromChannelId: string;
  toChannelId: string;
  nonce?: number;
}

interface ChannelTransitionPortalProps {
  transition: ChannelTransition | null;
  videoSrc: string;
  posterUrl: string;
  onComplete: () => void;
}

const TRANSFER_DURATION_MS = 1550;
const REDUCED_DURATION_MS = 160;

/**
 * Instant automatic cinematic glitch-transfer overlay (no scroll-lock, no body pinning, no SCROLL prompt).
 * Runs for ~640ms on channel switch using AsciiDotsRenderer signal-tear RGB slices + GlitchText title
 * assembly, then smoothly dissolves into the target channel world without interrupting live audio.
 */
export function ChannelTransitionPortal({
  transition,
  videoSrc,
  posterUrl,
  onComplete,
}: ChannelTransitionPortalProps) {
  const hookReducedMotion = Boolean(useReducedMotion());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const posterImgRef = useRef<HTMLImageElement | null>(null);
  const rendererRef = useRef<AsciiDotsRenderer | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [exiting, setExiting] = useState(false);

  const transitionKey = transition
    ? `${transition.fromChannelId}->${transition.toChannelId}:${transition.nonce ?? 0}`
    : '';

  const fromProfile = useMemo(
    () => resolveChannelAsciiProfile(transition?.fromChannelId || 'ch-main'),
    [transition?.fromChannelId]
  );
  const toProfile = useMemo(
    () => resolveChannelAsciiProfile(transition?.toChannelId || 'ch-deep'),
    [transition?.toChannelId]
  );
  const copy = useMemo(
    () => resolveChannelPortalCopy(transition?.toChannelId || 'ch-deep'),
    [transition?.toChannelId]
  );

  // Keep decoded poster ready for immediate first frame
  useEffect(() => {
    const img = new Image();
    img.decoding = 'async';
    img.src = posterUrl;
    posterImgRef.current = img;
    return () => {
      img.onload = null;
    };
  }, [posterUrl]);

  useEffect(() => {
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!transition || !transitionKey) return;

    const reducedMotion =
      hookReducedMotion ||
      (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    setExiting(false);

    if (reducedMotion || document.hidden) {
      const fadeTimer = window.setTimeout(() => setExiting(true), 40);
      const doneTimer = window.setTimeout(() => {
        onCompleteRef.current();
      }, REDUCED_DURATION_MS);
      return () => {
        window.clearTimeout(fadeTimer);
        window.clearTimeout(doneTimer);
      };
    }

    if (!rendererRef.current) {
      rendererRef.current = new AsciiDotsRenderer();
    }
    const renderer = rendererRef.current;

    // Try grabbing the live background <video> element already playing in DOM for instant zero-lag glitch slicing
    const bgVideo = document.querySelector<HTMLVideoElement>('.evening-background__source');
    const localVideo = videoRef.current;
    if (localVideo && !bgVideo) {
      void localVideo.play().catch(() => {});
    }

    const startMs = performance.now();
    let rafId = 0;
    let finished = false;
    let fadeTriggered = false;

    const completeNow = () => {
      if (finished) return;
      finished = true;
      window.cancelAnimationFrame(rafId);
      onCompleteRef.current();
    };

    const safetyTimer = window.setTimeout(completeNow, TRANSFER_DURATION_MS + 200);

    const tick = (nowMs: number) => {
      if (finished) return;
      if (document.hidden) {
        completeNow();
        return;
      }

      const elapsed = nowMs - startMs;
      const progress = Math.max(0, Math.min(1, elapsed / TRANSFER_DURATION_MS));

      if (!fadeTriggered && progress >= 0.74) {
        fadeTriggered = true;
        setExiting(true);
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        const liveVid =
          bgVideo && bgVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && bgVideo.videoWidth > 0
            ? bgVideo
            : localVideo &&
                localVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
                localVideo.videoWidth > 0
              ? localVideo
              : null;

        const source = liveVid || posterImgRef.current;
        const surge = Math.pow(Math.sin(progress * Math.PI), 0.78);
        const morphedProfile = interpolateAsciiProfile(fromProfile, toProfile, progress, 0.82);

        renderer.renderFrame(canvas, source, {
          width,
          height,
          dpr: Math.min(window.devicePixelRatio || 1, 1.5),
          overscanTopPx: 0,
          timeSec: nowMs * 0.001 + progress * 3.2,
          profile: morphedProfile,
          animate: true,
          scale: 1 + surge * 0.075,
          continuousGlitch: true,
          transferSurge: surge,
        });
      }

      if (progress >= 1) {
        completeNow();
        return;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      finished = true;
      window.clearTimeout(safetyTimer);
      window.cancelAnimationFrame(rafId);
    };
  }, [transition, transitionKey, fromProfile, toProfile, hookReducedMotion]);

  if (!transition) return null;

  const portalStyle = {
    '--portal-bg': copy.bgHex,
    '--portal-accent': copy.accentHex,
    '--portal-secondary': copy.secondaryHex,
    '--portal-text': copy.textHex,
    '--portal-glow': `${copy.accentHex}55`,
  } as React.CSSProperties;

  return createPortal(
    <div
      key={transitionKey}
      className={`channel-transition-portal${exiting ? ' is-exiting' : ''}`}
      style={portalStyle}
      role="status"
      aria-live="polite"
      aria-label={`Переход на канал ${copy.title}`}
    >
      <video
        ref={videoRef}
        src={videoSrc}
        poster={posterUrl}
        muted
        playsInline
        preload="none"
        className="channel-transition-portal__video-fallback"
        aria-hidden="true"
      />
      <canvas
        ref={canvasRef}
        className="channel-transition-portal__canvas"
        aria-hidden="true"
      />
      <div className="channel-transition-portal__scanlines" aria-hidden="true" />
      <div className="channel-transition-portal__hud">
        <span className="channel-transition-portal__eyebrow">{copy.eyebrow}</span>
        <GlitchText
          as="div"
          text={copy.title}
          trigger="change"
          intensity="strong"
          accent={copy.accentHex}
          secondaryAccent="#4de4f4"
          burstOnMount
          className="channel-transition-portal__title"
        />
        <span className="channel-transition-portal__tagline">{copy.tagline}</span>
      </div>
      <div className="channel-transition-portal__bar" aria-hidden="true" />
    </div>,
    document.body
  );
}
