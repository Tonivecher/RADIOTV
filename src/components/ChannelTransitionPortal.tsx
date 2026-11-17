import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'framer-motion';
import MetroHero, { MetroHeroFrameContext } from '@/components/ui/scroll-locked-video-hero';
import {
  interpolateAsciiProfile,
  resolveChannelAsciiProfile,
  resolveChannelPortalCopy,
} from '../constants/ascii';
import { AsciiDotsRenderer } from '../utils/asciiDotsRenderer';
import '../styles/deep-portal.css';

export interface ChannelTransition {
  fromChannelId: string;
  toChannelId: string;
}

interface ChannelTransitionPortalProps {
  transition: ChannelTransition | null;
  videoSrc: string;
  posterUrl: string;
  onComplete: () => void;
}

const EXIT_DURATION_MS = 280;

/**
 * Scroll-locked genre transition overlay powered by MetroHero (`@/components/ui/scroll-locked-video-hero`).
 * Scrubbing through the portal continuously morphs the source channel visual profile
 * (e.g. subtle ASCII-glitch video on Main -> full ASCII dots on Deep -> violet-amber grid on DeepTech)
 * into the target genre without interrupting live audio playback.
 */
export function ChannelTransitionPortal({
  transition,
  videoSrc,
  posterUrl,
  onComplete,
}: ChannelTransitionPortalProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const [exitingForKey, setExitingForKey] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AsciiDotsRenderer | null>(null);
  const posterImgRef = useRef<HTMLImageElement | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const exitingKeyRef = useRef<string | null>(null);
  const exitTimerRef = useRef<number | undefined>(undefined);
  const absorbTimerRef = useRef<number | undefined>(undefined);
  const absorbCleanupRef = useRef<(() => void) | null>(null);

  const transitionKey = transition
    ? `${transition.fromChannelId}->${transition.toChannelId}`
    : '';
  const exiting = Boolean(transitionKey) && exitingForKey === transitionKey;

  const finishPortal = useCallback(() => {
    if (!transitionKey || exitingKeyRef.current === transitionKey) return;
    exitingKeyRef.current = transitionKey;
    setExitingForKey(transitionKey);

    // Absorb residual trackpad inertia right after unlock so the page doesn't jump past the hero.
    absorbCleanupRef.current?.();
    const absorbWheel = (event: WheelEvent) => {
      event.preventDefault();
    };
    window.addEventListener('wheel', absorbWheel, { passive: false, capture: true });
    const cleanup = () => {
      window.removeEventListener('wheel', absorbWheel, { capture: true });
      absorbCleanupRef.current = null;
    };
    absorbCleanupRef.current = cleanup;
    window.clearTimeout(absorbTimerRef.current);
    absorbTimerRef.current = window.setTimeout(cleanup, EXIT_DURATION_MS + 240);

    window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => {
      onCompleteRef.current();
    }, EXIT_DURATION_MS);
  }, [transitionKey]);

  useEffect(() => {
    exitingKeyRef.current = null;
    setExitingForKey(null);
    window.clearTimeout(exitTimerRef.current);
    window.clearTimeout(absorbTimerRef.current);
    absorbCleanupRef.current?.();
  }, [transitionKey]);

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
      window.clearTimeout(exitTimerRef.current);
      window.clearTimeout(absorbTimerRef.current);
      absorbCleanupRef.current?.();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

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

  const scrubDistance = useMemo(() => {
    if (typeof window === 'undefined') return 950;
    return window.matchMedia('(pointer: coarse)').matches ? 520 : 950;
  }, []);

  const handleRenderFrame = useCallback(
    ({ video, section, progress, timeSec, reducedMotion: rm }: MetroHeroFrameContext) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!rendererRef.current) {
        rendererRef.current = new AsciiDotsRenderer();
      }
      const width = Math.max(1, section.clientWidth || window.innerWidth);
      const height = Math.max(1, section.clientHeight || window.innerHeight);
      const hasVideo =
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;
      const source = hasVideo ? video : posterImgRef.current;
      const morphedProfile = interpolateAsciiProfile(fromProfile, toProfile, progress, 0.44);

      rendererRef.current.renderFrame(canvas, source, {
        width,
        height,
        dpr: window.devicePixelRatio || 1,
        overscanTopPx: 0,
        timeSec: timeSec + progress * 1.4,
        profile: morphedProfile,
        animate: !rm,
        scale: 1 + progress * 0.14,
        continuousGlitch: !rm && progress > 0.02 && progress < 0.98,
      });
    },
    [fromProfile, toProfile]
  );

  if (!transition) return null;

  const portalStyle = {
    '--portal-bg': copy.bgHex,
    '--portal-accent': copy.accentHex,
    '--portal-text': copy.textHex,
    '--portal-glow': `${copy.accentHex}44`,
  } as React.CSSProperties;

  return createPortal(
    <MetroHero
      key={transitionKey}
      className="channel-transition-portal"
      style={portalStyle}
      exiting={exiting}
      dialogRole
      videoSrc={videoSrc}
      posterSrc={posterUrl}
      eyebrow={copy.eyebrow}
      title={copy.title}
      scrollHint={reducedMotion ? '' : 'SCROLL'}
      tagline={copy.tagline}
      skipLabel={copy.skipLabel}
      signature={false}
      scrubDistance={scrubDistance}
      maxScale={0.14}
      taglineRange={[0.42, 0.76]}
      completionThreshold={0.985}
      accentColor={copy.accentHex}
      progressGradient={`linear-gradient(90deg, ${copy.accentHex}77, ${copy.accentHex}, ${copy.secondaryHex})`}
      titleFontFamily="var(--font-display)"
      bodyFontFamily="var(--font-body)"
      backdropSlot={
        <canvas
          ref={canvasRef}
          className="channel-transition-portal__canvas"
          aria-hidden="true"
        />
      }
      onRenderFrame={handleRenderFrame}
      onComplete={finishPortal}
      onSkip={finishPortal}
    />,
    document.body
  );
}
