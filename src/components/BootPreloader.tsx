import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'framer-motion';
import { useSpatialMotion } from './SpatialMotion';
import MetroHero from './ui/scroll-locked-video-hero';
import '../styles/boot-preloader.css';

interface BootPreloaderProps {
  isStateLoaded: boolean;
  isAudioReady: boolean;
  isVideoReady: boolean;
  errorText?: string;
  needsGesture: boolean;
  onPrepare: () => void;
  onRetry: () => void;
  onEnterEther: (withSound: boolean) => boolean | void | Promise<boolean | void>;
  onReveal?: () => void;
  onComplete?: () => void;
}

const POSTER = '/media/evening-poster.jpg';

export function BootPreloader({
  isStateLoaded,
  isAudioReady,
  isVideoReady,
  errorText,
  needsGesture,
  onPrepare,
  onRetry,
  onEnterEther,
  onReveal,
  onComplete,
}: BootPreloaderProps) {
  const [fontsReady, setFontsReady] = useState(false);
  const [fontError, setFontError] = useState('');
  const [fontRetry, setFontRetry] = useState(0);
  const [posterReady, setPosterReady] = useState(false);
  const [posterError, setPosterError] = useState('');
  const [posterRetry, setPosterRetry] = useState(0);
  const [phase, setPhase] = useState<'closed' | 'opening'>('closed');
  const [starting, setStarting] = useState(false);
  const [entryError, setEntryError] = useState('');

  const primaryButton = useRef<HTMLButtonElement>(null);
  const entering = useRef(false);
  const revealed = useRef(false);
  const completed = useRef(false);
  const readyRef = useRef(false);

  const reducedMotion = Boolean(useReducedMotion());
  const { prepareSensorPermission } = useSpatialMotion();

  useEffect(() => {
    let active = true;
    setFontsReady(false);
    setFontError('');
    const timer = window.setTimeout(() => {
      if (active) {
        setFontError('Шрифты загружаются слишком долго. Попробуйте ещё раз.');
      }
    }, 20000);

    const load = async () => {
      try {
        const link = document.querySelector<HTMLLinkElement>('#radio-fonts');
        if (!link) {
          throw new Error('Font stylesheet missing');
        }
        if (fontRetry) {
          await new Promise<void>((resolve, reject) => {
            const copy = link.cloneNode() as HTMLLinkElement;
            const url = new URL(link.href);
            url.searchParams.set('retry', String(fontRetry));
            copy.href = url.href;
            copy.media = 'all';
            copy.onload = () => {
              link.remove();
              resolve();
            };
            copy.onerror = () => {
              copy.remove();
              reject(new Error('Font stylesheet unavailable'));
            };
            document.head.append(copy);
          });
        } else {
          if (!link.sheet) {
            await new Promise<void>((resolve, reject) => {
              link.addEventListener('load', () => resolve(), { once: true });
              link.addEventListener(
                'error',
                () => reject(new Error('Font stylesheet unavailable')),
                { once: true }
              );
              if (link.sheet) {
                resolve();
              }
            });
          }
          link.media = 'all';
        }

        let loaded = false;
        for (let attempt = 0; attempt < 4 && active; attempt++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await document.fonts.ready;
          try {
            const faces = await Promise.all([
              document.fonts.load('400 24px Manrope', 'ToniVecherRadio Основной'),
              document.fonts.load('500 24px Manrope', 'Настройте звук'),
              document.fonts.load('400 16px Inter', 'Музыка на вечер Deep'),
              document.fonts.load('500 16px Inter', 'Эфир'),
              document.fonts.load('600 16px Inter', 'Слушать'),
            ]);
            loaded = faces.every(
              (group) =>
                group.length > 0 && group.every((face) => face.status === 'loaded')
            );
          } catch {
            loaded = false;
          }
          if (loaded) {
            break;
          }
          if (attempt < 3) {
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, 150 * (attempt + 1))
            );
          }
        }
        if (!loaded) {
          throw new Error('Fonts unavailable');
        }
        if (active) {
          setFontsReady(true);
          setFontError('');
        }
      } catch {
        if (active) {
          setFontError('Не удалось загрузить шрифты. Проверьте соединение и повторите.');
        }
      } finally {
        window.clearTimeout(timer);
      }
    };

    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fontRetry]);

  useEffect(() => {
    let active = true;
    setPosterReady(false);
    setPosterError('');
    const poster = new Image();
    const timer = window.setTimeout(() => {
      if (active) {
        setPosterError('Не удалось загрузить обложку. Попробуйте ещё раз.');
      }
    }, 20000);

    poster.onload = () => {
      void poster
        .decode()
        .then(() => {
          if (active) {
            setPosterReady(true);
            setPosterError('');
          }
        })
        .catch(() => {
          if (active) {
            setPosterError('Не удалось открыть обложку. Попробуйте ещё раз.');
          }
        })
        .finally(() => window.clearTimeout(timer));
    };

    poster.onerror = () => {
      window.clearTimeout(timer);
      if (active) {
        setPosterError('Не удалось загрузить обложку. Попробуйте ещё раз.');
      }
    };

    poster.src = POSTER;
    return () => {
      active = false;
      poster.onload = null;
      poster.onerror = null;
      window.clearTimeout(timer);
    };
  }, [posterRetry]);

  const resources = [
    { label: 'Оформление', ready: fontsReady && posterReady && isVideoReady },
    { label: 'Эфир', ready: isStateLoaded },
    { label: 'Звук', ready: isAudioReady },
  ];
  const error = errorText || fontError || posterError;
  const ready = resources.every((item) => item.ready) && !error;
  readyRef.current = ready;
  const busy = starting || phase !== 'closed';
  const completedCount = resources.filter((item) => item.ready).length;
  const loadPct = Math.round((completedCount / 3) * 100);

  const finishUnmount = () => {
    if (completed.current) return;
    completed.current = true;
    if (!revealed.current) {
      revealed.current = true;
      onReveal?.();
    }
    onComplete?.();
  };

  const enter = async (withSound: boolean, fromScroll = false) => {
    if (!readyRef.current || entering.current) {
      return;
    }
    entering.current = true;
    setStarting(true);
    setEntryError('');
    try {
      const acceptance = onEnterEther(withSound);
      prepareSensorPermission();
      let accepted = await acceptance;
      if (accepted === false && fromScroll && withSound) {
        accepted = await onEnterEther(false);
      }
      if (accepted === false) {
        throw new Error('Playback not ready');
      }
      if (!revealed.current) {
        revealed.current = true;
        onReveal?.();
      }
      setPhase('opening');
      window.setTimeout(finishUnmount, reducedMotion ? 80 : 940);
    } catch {
      entering.current = false;
      setEntryError('Жми «Войти со звуком» или «Войти без звука».');
    } finally {
      setStarting(false);
    }
  };

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') {
      return;
    }
    const controls = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    );
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) {
      e.preventDefault();
      e.currentTarget.focus();
      return;
    }
    if (
      e.shiftKey &&
      (document.activeElement === first || document.activeElement === e.currentTarget)
    ) {
      e.preventDefault();
      last.focus();
    } else if (
      !e.shiftKey &&
      (document.activeElement === last || document.activeElement === e.currentTarget)
    ) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <MetroHero
      className={`moscow-intro moscow-intro--${phase}`}
      title="ВАГОН 4:20"
      scrollHint={ready ? 'СКРОЛЛ' : `ЗАГРУЗКА ${loadPct}%`}
      tagline="Твоя остановка. Двери открыты."
      canUnlock={ready}
      fastForward={phase === 'opening'}
      onUnlock={() => void enter(true, true)}
      onKeyDown={handleDialogKeyDown}
      ariaBusy={!ready || busy}
    >
      {/* Hidden/accessible progressbar for screen readers & tests */}
      <div
        className="moscow-intro__sr-only"
        role="progressbar"
        aria-label="Готовность радио"
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={completedCount}
      />

      {/* Discreet bottom-left corner controls matching the bottom-right signature */}
      <div className="moscow-intro__corner-actions">
        {ready ? (
          <>
            <button
              ref={primaryButton}
              type="button"
              className="moscow-intro__primary"
              disabled={busy}
              onClick={() => void enter(true, false)}
            >
              Войти со звуком ↗
            </button>
            <span className="moscow-intro__corner-sep" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              className="moscow-intro__secondary"
              disabled={busy}
              onClick={() => void enter(false, false)}
            >
              Войти без звука
            </button>
          </>
        ) : (
          <button
            type="button"
            className="moscow-intro__prepare"
            disabled={busy}
            onClick={onPrepare}
          >
            {needsGesture ? 'Нажми, чтобы разбудить звук' : `Готовим вагон · ${loadPct}%`}
          </button>
        )}
      </div>

      {(error || entryError) && (
        <div className="moscow-intro__error" role="alert">
          <p>{error || entryError}</p>
          {error && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!fontsReady) setFontRetry((v) => v + 1);
                if (!posterReady) setPosterRetry((v) => v + 1);
                onRetry();
              }}
            >
              Повторить загрузку
            </button>
          )}
        </div>
      )}
    </MetroHero>,
    document.body
  );
}
