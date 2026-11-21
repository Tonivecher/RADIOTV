import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { getReactiveAudioEnergy } from '../audio/reactiveTelemetry';
import { resolveChannelAsciiProfile } from '../constants/ascii';
import { AsciiDotsRenderer } from '../utils/asciiDotsRenderer';
import { bindBallLightningInteraction } from '../utils/asciiGlobe';
import { safeStorage } from '../utils/storage';
import { useSpatialMotion } from './SpatialMotion';

export interface BackgroundHandle {
  prepare: () => void;
}

export interface BackgroundMediaInfo {
  blobUrl: string;
  sourceUrl: string;
  posterUrl: string;
}

interface EveningBackgroundProps {
  channelId: string;
  portalActive?: boolean;
  onReady: () => void;
  onError: (message: string) => void;
  onNeedsGesture: () => void;
  onMediaChange?: (media: BackgroundMediaInfo) => void;
  retry: number;
  showControls: boolean;
  controlsHost: HTMLElement | null;
}

const TARGET_FPS_MS = 1000 / 24;

/** Fetch the small loop completely and render it through the live ASCII-dots pipeline. */
export const EveningBackground = forwardRef<BackgroundHandle, EveningBackgroundProps>(
  function EveningBackground(
    {
      channelId,
      portalActive = false,
      onReady,
      onError,
      onNeedsGesture,
      onMediaChange,
      retry,
      showControls,
      controlsHost,
    },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const posterImgRef = useRef<HTMLImageElement | null>(null);
    const rendererRef = useRef<AsciiDotsRenderer | null>(null);
    const stageSizeRef = useRef({ width: 0, height: 0 });

    const callbacks = useRef({ onReady, onError, onNeedsGesture, onMediaChange });
    callbacks.current = { onReady, onError, onNeedsGesture, onMediaChange };

    const reducedMotion = useReducedMotion();
    const [source] = useState(() =>
      window.matchMedia('(max-width: 760px)').matches
        ? '/media/evening-mobile.mp4'
        : '/media/evening-desktop.mp4'
    );
    const [blobUrl, setBlobUrl] = useState('');
    const cachedUrl = useRef('');
    const previousRetry = useRef(retry);
    const [paused, setPaused] = useState(
      () => safeStorage.getItem('radiotv_video_paused') === '1'
    );
    const [localRetry, setLocalRetry] = useState(0);
    const [error, setError] = useState('');
    const [preparing, setPreparing] = useState(false);
    const [videoReady, setVideoReady] = useState(false);
    const [posterLoadedTick, setPosterLoadedTick] = useState(0);

    const posterUrl = `/media/evening-poster.jpg?retry=${retry}-${localRetry}`;
    const localRetryRef = useRef(localRetry);

    const ready = () => {
      setPreparing(false);
      setError('');
      callbacks.current.onReady();
    };

    const fail = (message: string) => {
      setPreparing(false);
      setVideoReady(false);
      setError(message);
      callbacks.current.onError(message);
    };

    const { x: pointerX, y: pointerY, backgroundX, backgroundY, visible, setBackgroundPaused } =
      useSpatialMotion();

    useEffect(() => {
      setBackgroundPaused(paused);
    }, [paused, setBackgroundPaused]);

    useEffect(() => {
      callbacks.current.onMediaChange?.({
        blobUrl,
        sourceUrl: source,
        posterUrl,
      });
    }, [blobUrl, source, posterUrl]);

    const prepare = () => {
      const video = videoRef.current;
      if (!document.hidden && !paused && !reducedMotion && video?.src) {
        void video.play().catch(() => callbacks.current.onNeedsGesture());
      }
    };

    useImperativeHandle(ref, () => ({ prepare }));

    // Keep poster image decoded so ASCII rendering has an immediate fallback on pause / reduced motion.
    useEffect(() => {
      let active = true;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (!active) return;
        posterImgRef.current = img;
        setPosterLoadedTick((t) => t + 1);
      };
      img.src = posterUrl;
      return () => {
        active = false;
        img.onload = null;
      };
    }, [posterUrl]);

    useEffect(() => {
      const controller = new AbortController();
      let active = true;
      if (previousRetry.current !== retry || localRetryRef.current !== localRetry) {
        if (cachedUrl.current) {
          URL.revokeObjectURL(cachedUrl.current);
        }
        cachedUrl.current = '';
        setBlobUrl('');
        setVideoReady(false);
        previousRetry.current = retry;
        localRetryRef.current = localRetry;
      }

      let timer: number | undefined;
      let bootGraceTimer: number | undefined;
      const watchProgress = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          controller.abort();
          if (active) {
            if (posterImgRef.current) {
              ready();
            } else {
              fail('Видео загружается слишком долго. Попробуйте ещё раз.');
            }
          }
        }, 25000);
      };
      watchProgress();
      // Never block preloader beyond 2s waiting for ambient background MP4 (crucial for iOS Low Power / background tabs).
      bootGraceTimer = window.setTimeout(() => {
        if (active) {
          ready();
        }
      }, 2000);

      // Always keep poster image warmed for instant ASCII backdrop & safe fallback.
      if (!posterImgRef.current) {
        const posterImg = new Image();
        posterImg.onload = () => {
          if (active) {
            posterImgRef.current = posterImg;
            setPosterLoadedTick((t) => t + 1);
            if (reducedMotion || paused) {
              ready();
            }
          }
        };
        posterImg.src = posterUrl;
      } else if (reducedMotion || paused) {
        ready();
      }

      const load = async () => {
        try {
          if (reducedMotion || paused) {
            return;
          } else if (!cachedUrl.current) {
            setPreparing(true);
            const res = await fetch(source, {
              signal: controller.signal,
              cache: retry ? 'reload' : 'default',
            });
            if (!res.ok) {
              throw new Error('Video unavailable');
            }
            watchProgress();

            let blob: Blob;
            if (res.body) {
              const reader = res.body.getReader();
              const chunks: BlobPart[] = [];
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    break;
                  }
                  if (value.byteLength) {
                    chunks.push(value);
                    watchProgress();
                  }
                }
              } finally {
                reader.releaseLock();
              }
              blob = new Blob(chunks, {
                type: res.headers.get('content-type') || 'video/mp4',
              });
            } else {
              blob = await res.blob();
            }

            if (!blob.size) {
              throw new Error('Empty video');
            }
            if (!active || controller.signal.aborted) {
              return;
            }
            cachedUrl.current = URL.createObjectURL(blob);
            setBlobUrl(cachedUrl.current);
          }
        } catch {
          if (active && !controller.signal.aborted) {
            if (posterImgRef.current) {
              ready();
            } else {
              fail('Не удалось загрузить фон. Попробуйте ещё раз.');
            }
          }
        } finally {
          window.clearTimeout(timer);
          window.clearTimeout(bootGraceTimer);
        }
      };

      void load();
      return () => {
        active = false;
        window.clearTimeout(timer);
        window.clearTimeout(bootGraceTimer);
        controller.abort();
      };
    }, [source, retry, localRetry, reducedMotion, paused]);

    useEffect(() => {
      const unbindGlobe = bindBallLightningInteraction();
      return () => {
        unbindGlobe();
        if (cachedUrl.current) {
          URL.revokeObjectURL(cachedUrl.current);
        }
        rendererRef.current?.dispose();
        rendererRef.current = null;
      };
    }, []);

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !blobUrl || reducedMotion) {
        return;
      }
      let active = true;
      let frame = 0;
      let confirmed = false;

      const confirm = (allowPosterFallback = false) => {
        if (!active || confirmed) {
          return;
        }
        const hasVideo = video.readyState >= 2 && video.videoWidth > 0;
        if (!hasVideo && !allowPosterFallback) {
          return;
        }
        confirmed = true;
        if (!paused && hasVideo) {
          setVideoReady(true);
        }
        ready();
      };

      const loaded = () => {
        // Confirm immediately on HAVE_CURRENT_DATA instead of waiting for requestVideoFrameCallback
        // (iOS Safari Low Power Mode & hidden-under-preloader video can never emit rVFC until gesture).
        confirm(false);
      };

      const syncVisibility = () => {
        if (document.hidden || paused) {
          video.pause();
        } else {
          prepare();
        }
      };

      video.addEventListener('loadeddata', loaded);
      video.addEventListener('canplay', loaded);
      document.addEventListener('visibilitychange', syncVisibility);
      // Graceful mobile fallback: if iOS/Android defers video decode until user tap, unblock boot with poster.
      const fallbackTimer = window.setTimeout(() => {
        if (!confirmed && posterImgRef.current) {
          confirm(true);
        }
      }, 1500);
      const timer = window.setTimeout(() => {
        if (!confirmed) {
          confirm(true);
        }
      }, 3200);

      if (video.readyState >= 2) {
        loaded();
      }
      if (document.hidden || paused) {
        video.pause();
      } else {
        prepare();
      }

      return () => {
        active = false;
        window.clearTimeout(fallbackTimer);
        window.clearTimeout(timer);
        if (frame && video.cancelVideoFrameCallback) {
          video.cancelVideoFrameCallback(frame);
        }
        video.removeEventListener('loadeddata', loaded);
        video.removeEventListener('canplay', loaded);
        document.removeEventListener('visibilitychange', syncVisibility);
      };
    }, [blobUrl, reducedMotion, paused]);

    // Track ambient container size and render live / static ASCII-dots frames.
    useEffect(() => {
      const stage = stageRef.current;
      const canvas = canvasRef.current;
      if (!stage || !canvas) return;

      if (!rendererRef.current) {
        rendererRef.current = new AsciiDotsRenderer();
      }
      const renderer = rendererRef.current;
      const profile = resolveChannelAsciiProfile(channelId);

      const measure = () => {
        const rect = stage.getBoundingClientRect();
        stageSizeRef.current = {
          width: Math.max(1, Math.round(rect.width || window.innerWidth)),
          height: Math.max(1, Math.round(rect.height || window.innerHeight)),
        };
      };
      measure();

      const drawOnce = (nowMs: number, animate: boolean) => {
        const { width, height } = stageSizeRef.current;
        const video = videoRef.current;
        const hasVideoFrame =
          !reducedMotion &&
          video &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0;
        const mediaSource = hasVideoFrame ? video : posterImgRef.current;
        const timeSec = nowMs * 0.001;
        const energy = getReactiveAudioEnergy(timeSec);
        const normX = window.innerWidth > 0 ? Math.max(0, Math.min(1, pointerX.get() / window.innerWidth)) : 0.5;
        const normY = window.innerHeight > 0 ? Math.max(0, Math.min(1, pointerY.get() / window.innerHeight)) : 0.5;

        renderer.renderFrame(canvas, mediaSource, {
          width,
          height,
          dpr: 1,
          overscanTopPx: 44,
          timeSec,
          profile,
          animate,
          audioLevel: energy.level,
          pointerX: normX,
          pointerY: normY,
        });
      };

      const observer = new ResizeObserver(() => {
        measure();
        drawOnce(performance.now(), !paused && !reducedMotion && visible);
      });
      observer.observe(stage);

      const shouldStream = !paused && !reducedMotion && visible && !portalActive;
      drawOnce(performance.now(), shouldStream);

      if (!shouldStream) {
        return () => {
          observer.disconnect();
        };
      }

      let rafId = 0;
      let lastDrawAt = 0;
      const tick = (nowMs: number) => {
        if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          rafId = 0;
          return;
        }
        if (nowMs - lastDrawAt >= TARGET_FPS_MS) {
          lastDrawAt = nowMs;
          drawOnce(nowMs, true);
        }
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);

      return () => {
        observer.disconnect();
        window.cancelAnimationFrame(rafId);
      };
    }, [channelId, paused, reducedMotion, visible, portalActive, blobUrl, posterLoadedTick, pointerX, pointerY]);

    const toggleVideo = () => {
      const next = !paused;
      safeStorage.setItem('radiotv_video_paused', next ? '1' : '0');
      if (next) {
        videoRef.current?.pause();
      } else if (blobUrl && !reducedMotion) {
        void videoRef.current?.play().catch(() => callbacks.current.onNeedsGesture());
      }
      setPaused(next);
    };

    const backgroundPaused = paused || !visible || Boolean(reducedMotion);
    const showAurora = paused || Boolean(error) || Boolean(reducedMotion) || !videoReady;

    return (
      <>
        <div className="evening-background" aria-hidden="true">
          <motion.div
            className="evening-background__pointer"
            style={{ x: backgroundX, y: backgroundY }}
          >
            <div
              className="evening-background__scroll"
              data-paused={backgroundPaused ? 'true' : undefined}
            >
              <div
                ref={stageRef}
                className="evening-background__ambient"
                data-paused={backgroundPaused ? 'true' : undefined}
              >
                {!reducedMotion && (
                  <video
                    ref={videoRef}
                    className="evening-background__source"
                    src={blobUrl || undefined}
                    poster={posterUrl}
                    muted
                    loop
                    playsInline
                    preload="auto"
                    onError={() => fail('Не удалось открыть видео. Попробуйте ещё раз.')}
                  />
                )}
                <canvas ref={canvasRef} className="evening-background__canvas" />
              </div>
            </div>
          </motion.div>
          <div
            className="evening-aurora"
            data-active={showAurora ? 'true' : 'false'}
            data-paused={!visible ? 'true' : undefined}
            data-static={reducedMotion ? 'true' : undefined}
          >
            <div className="evening-aurora__layer" />
          </div>
          <div className="evening-background__shade" />
        </div>

        {showControls &&
          controlsHost &&
          createPortal(
            <div className="background-controls">
              <button
                type="button"
                className="background-toggle"
                aria-pressed={paused || Boolean(reducedMotion)}
                aria-label={
                  error
                    ? 'Повторить загрузку видео'
                    : reducedMotion
                      ? 'Статичный фон'
                      : paused
                        ? 'Включить видео'
                        : preparing
                          ? 'Загружаем видео'
                          : 'Остановить видео'
                }
                title={
                  error ||
                  (reducedMotion
                    ? 'Статичный фон'
                    : paused
                      ? 'Включить видео'
                      : 'Остановить видео')
                }
                onClick={
                  error
                    ? () => {
                        setError('');
                        setLocalRetry((v) => v + 1);
                      }
                    : toggleVideo
                }
                disabled={Boolean(reducedMotion) && !error}
                aria-busy={preparing}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="16" rx="5" />
                  {error ? (
                    <path d="M12 8v5m0 3h.01" />
                  ) : paused || reducedMotion ? (
                    <path d="m10 8 5 4-5 4Z" />
                  ) : (
                    <path d="M10 8v8m4-8v8" />
                  )}
                </svg>
                <span>{error ? 'Повторить' : 'Фон'}</span>
              </button>
              {error && (
                <span className="visually-hidden" role="alert">
                  {error}
                </span>
              )}
            </div>,
            controlsHost
          )}
      </>
    );
  }
);
