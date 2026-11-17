import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { safeStorage } from '../utils/storage';
import { useSpatialMotion } from './SpatialMotion';

export interface BackgroundHandle {
  prepare: () => void;
}

interface EveningBackgroundProps {
  onReady: () => void;
  onError: (message: string) => void;
  onNeedsGesture: () => void;
  retry: number;
  showControls: boolean;
  controlsHost: HTMLElement | null;
}

/** Fetch the small loop completely; the first repeat never needs another network request. */
export const EveningBackground = forwardRef<BackgroundHandle, EveningBackgroundProps>(
  function EveningBackground(
    { onReady, onError, onNeedsGesture, retry, showControls, controlsHost },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const callbacks = useRef({ onReady, onError, onNeedsGesture });
    callbacks.current = { onReady, onError, onNeedsGesture };

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

    const posterUrl = `/media/evening-poster.jpg?retry=${retry}-${localRetry}`;
    const localRetryRef = useRef(localRetry);

    const ready = () => {
      setPreparing(false);
      setError('');
      callbacks.current.onReady();
    };

    const fail = (message: string) => {
      setPreparing(false);
      setError(message);
      callbacks.current.onError(message);
    };

    const { backgroundX, backgroundY, visible, setBackgroundPaused } = useSpatialMotion();

    useEffect(() => {
      setBackgroundPaused(paused);
    }, [paused, setBackgroundPaused]);

    const prepare = () => {
      const video = videoRef.current;
      if (!document.hidden && !paused && !reducedMotion && video?.src) {
        void video.play().catch(() => callbacks.current.onNeedsGesture());
      }
    };

    useImperativeHandle(ref, () => ({ prepare }));

    useEffect(() => {
      const controller = new AbortController();
      let active = true;
      if (previousRetry.current !== retry || localRetryRef.current !== localRetry) {
        if (cachedUrl.current) {
          URL.revokeObjectURL(cachedUrl.current);
        }
        cachedUrl.current = '';
        setBlobUrl('');
        previousRetry.current = retry;
        localRetryRef.current = localRetry;
      }

      let timer: number | undefined;
      const watchProgress = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          controller.abort();
          if (active) {
            fail('Видео загружается слишком долго. Попробуйте ещё раз.');
          }
        }, 25000);
      };
      watchProgress();

      const load = async () => {
        try {
          if (reducedMotion || paused) {
            const img = new Image();
            img.src = posterUrl;
            await img.decode();
            if (active) {
              ready();
            }
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
            fail('Не удалось загрузить фон. Попробуйте ещё раз.');
          }
        } finally {
          window.clearTimeout(timer);
        }
      };

      void load();
      return () => {
        active = false;
        window.clearTimeout(timer);
        controller.abort();
      };
    }, [source, retry, localRetry, reducedMotion, paused]);

    useEffect(() => {
      return () => {
        if (cachedUrl.current) {
          URL.revokeObjectURL(cachedUrl.current);
        }
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

      const confirm = () => {
        if (!active || confirmed || video.readyState < 2 || !video.videoWidth) {
          return;
        }
        confirmed = true;
        ready();
      };

      const loaded = () => {
        // loadeddata guarantees a decoded current frame; rVFC verifies presentation where supported.
        if (paused) {
          confirm();
        } else if (video.requestVideoFrameCallback) {
          frame = video.requestVideoFrameCallback(confirm);
        } else {
          confirm();
        }
      };

      const syncVisibility = () => {
        if (document.hidden || paused) {
          video.pause();
        } else {
          prepare();
        }
      };

      video.addEventListener('loadeddata', loaded);
      document.addEventListener('visibilitychange', syncVisibility);
      const timer = window.setTimeout(() => {
        if (!confirmed) {
          fail('Не удалось подготовить видео. Нажмите «Подготовить» или повторите загрузку.');
        }
      }, 15000);

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
        window.clearTimeout(timer);
        if (frame) {
          video.cancelVideoFrameCallback(frame);
        }
        video.removeEventListener('loadeddata', loaded);
        document.removeEventListener('visibilitychange', syncVisibility);
      };
    }, [blobUrl, reducedMotion, paused]);

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
                className="evening-background__ambient"
                data-paused={backgroundPaused ? 'true' : undefined}
              >
                {reducedMotion || (paused && !blobUrl) ? (
                  <img src={posterUrl} alt="" />
                ) : (
                  <video
                    ref={videoRef}
                    src={blobUrl || undefined}
                    poster={posterUrl}
                    muted
                    loop
                    playsInline
                    preload="auto"
                    onError={() => fail('Не удалось открыть видео. Попробуйте ещё раз.')}
                  />
                )}
              </div>
            </div>
          </motion.div>
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
