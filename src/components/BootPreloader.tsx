import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { RadioMark } from './RadioMark';
import { useSpatialMotion } from './SpatialMotion';
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
const GATE_EASE = [0.76, 0, 0.24, 1] as const;

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
  const [phase, setPhase] = useState<'closed' | 'fading' | 'opening'>('closed');
  const [starting, setStarting] = useState(false);
  const [entryError, setEntryError] = useState('');

  const dialog = useRef<HTMLDivElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const entering = useRef(false);
  const revealed = useRef(false);
  const completed = useRef(false);
  const reducedMotion = useReducedMotion();
  const { prepareSensorPermission } = useSpatialMotion();

  useEffect(() => {
    dialog.current?.focus();
  }, []);

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

        // WebKit can expose the stylesheet before registering its font faces.
        // Retry the real readiness check briefly; never treat fallback fonts as ready.
        let loaded = false;
        for (let attempt = 0; attempt < 4 && active; attempt++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await document.fonts.ready;
          try {
            const faces = await Promise.all([
              document.fonts.load('400 24px "Plus Jakarta Sans"', 'ToniVecherRadio'),
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
  const busy = starting || phase !== 'closed';
  const completedCount = resources.filter((item) => item.ready).length;

  useEffect(() => {
    if (ready && !entering.current && dialog.current?.contains(document.activeElement)) {
      dialog.current.focus();
      primaryButton.current?.focus();
    }
  }, [ready]);

  const enter = async (withSound: boolean) => {
    if (!ready || entering.current) {
      return;
    }
    entering.current = true;
    setStarting(true);
    setEntryError('');
    try {
      // Invoke before the first await: Safari must receive play/resume in this tap.
      const acceptance = onEnterEther(withSound);
      prepareSensorPermission();
      const accepted = await acceptance;
      if (accepted === false) {
        throw new Error('Playback not ready');
      }
      dialog.current?.focus();
      setPhase('fading');
    } catch {
      entering.current = false;
      setEntryError(
        'Звук пока не запустился. Нажмите «Войти со звуком» ещё раз или войдите без звука.'
      );
    } finally {
      setStarting(false);
    }
  };

  const reveal = () => {
    if (phase !== 'fading' || revealed.current) {
      return;
    }
    revealed.current = true;
    onReveal?.();
    setPhase('opening');
  };

  const complete = () => {
    if (phase !== 'opening' || completed.current) {
      return;
    }
    completed.current = true;
    onComplete?.();
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

  const gateTransition = {
    duration: reducedMotion ? 0.12 : 1.2,
    ease: GATE_EASE,
    opacity: {
      duration: reducedMotion ? 0.12 : 1.2,
      ease: [0.4, 0, 0.2, 1] as const,
    },
  };

  return createPortal(
    <div
      ref={dialog}
      tabIndex={-1}
      className={`moscow-intro moscow-intro--${phase}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="moscow-intro-title"
      aria-describedby="moscow-intro-description"
      aria-busy={!ready || busy}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="moscow-intro__gates" aria-hidden="true">
        <motion.div
          className="moscow-intro__gate moscow-intro__gate--left"
          initial={false}
          animate={{
            x: phase === 'opening' && !reducedMotion ? '-100%' : 0,
            opacity: phase === 'opening' ? 0 : 1,
            scale: phase === 'opening' && !reducedMotion ? 1.025 : 1,
          }}
          transition={gateTransition}
        >
          <div className="moscow-intro__city" />
        </motion.div>
        <motion.div
          className="moscow-intro__gate moscow-intro__gate--right"
          initial={false}
          animate={{
            x: phase === 'opening' && !reducedMotion ? '100%' : 0,
            opacity: phase === 'opening' ? 0 : 1,
            scale: phase === 'opening' && !reducedMotion ? 1.025 : 1,
          }}
          transition={gateTransition}
          onAnimationComplete={complete}
        >
          <div className="moscow-intro__city" />
        </motion.div>
      </div>

      <motion.div
        className="moscow-intro__content"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase !== 'closed' ? 0 : 1 }}
        transition={{
          duration: reducedMotion ? 0 : phase !== 'closed' ? 0.22 : 0.6,
          ease: 'easeOut',
        }}
        onAnimationComplete={reveal}
      >
        <header className="moscow-intro__header">
          <RadioMark size={30} />
          <span>ToniVecherRadio</span>
          <span className="moscow-intro__location">Москва · вечерний эфир</span>
        </header>

        <main className="moscow-intro__center">
          <span className="moscow-intro__eyebrow">Музыка на вечер</span>
          <h1 id="moscow-intro-title" className="moscow-intro__title">
            ToniVecherRadio
          </h1>
          <p id="moscow-intro-description" className="moscow-intro__description">
            Deep-tech, tech, deep и downtempo.
            <br />
            Выберите, как войти в эфир.
          </p>

          <div
            className={`moscow-intro__loader${ready ? ' is-ready' : ''}`}
            aria-hidden="true"
          >
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>

          <div className="moscow-intro__resources" aria-live="polite" aria-atomic="true">
            <p className="moscow-intro__status">
              {starting
                ? 'Запускаем звук'
                : busy
                  ? 'Открываем эфир'
                  : ready
                    ? 'Всё готово. Добро пожаловать.'
                    : 'Готовим радио'}
            </p>
            <div className="moscow-intro__resource-items">
              {resources.map((item) => (
                <span key={item.label} className={item.ready ? 'is-ready' : ''}>
                  <i aria-hidden="true" />
                  {item.label}
                  <small>{item.ready ? 'Готово' : 'Загружаем'}</small>
                </span>
              ))}
            </div>
          </div>

          <div
            className="moscow-intro__progress"
            role="progressbar"
            aria-label="Готовность радио"
            aria-valuemin={0}
            aria-valuemax={3}
            aria-valuenow={completedCount}
          >
            <span style={{ transform: `scaleX(${completedCount / 3})` }} />
          </div>

          {error && (
            <div className="moscow-intro__error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!fontsReady) {
                    setFontRetry((v) => v + 1);
                  }
                  if (!posterReady) {
                    setPosterRetry((v) => v + 1);
                  }
                  onRetry();
                }}
              >
                Повторить загрузку
              </button>
            </div>
          )}

          {entryError && !error && (
            <div className="moscow-intro__error" role="alert">
              <p>{entryError}</p>
            </div>
          )}

          <AnimatePresence
            initial={false}
            mode="wait"
            onExitComplete={() => {
              if (!busy && document.activeElement === document.body) {
                dialog.current?.focus();
              }
            }}
          >
            {ready ? (
              <motion.div
                key="entry"
                className="moscow-intro__actions"
                initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
                transition={{ duration: reducedMotion ? 0 : 0.25, ease: 'easeOut' }}
                onAnimationComplete={() => {
                  if (!busy && document.activeElement === dialog.current) {
                    primaryButton.current?.focus();
                  }
                }}
              >
                <button
                  ref={primaryButton}
                  type="button"
                  className="moscow-intro__primary"
                  disabled={busy}
                  onClick={() => enter(true)}
                >
                  {busy ? 'Открываем эфир' : 'Войти со звуком'}
                  <span aria-hidden="true">↗</span>
                </button>
                <button
                  type="button"
                  className="moscow-intro__secondary"
                  disabled={busy}
                  onClick={() => enter(false)}
                >
                  Войти без звука
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="prepare"
                initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
                transition={{ duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' }}
              >
                <button
                  className="moscow-intro__prepare"
                  type="button"
                  disabled={busy}
                  onClick={onPrepare}
                >
                  {needsGesture
                    ? 'Нажмите, чтобы подготовить радио'
                    : 'Подготовить радио'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="moscow-intro__footer">
          <span>Независимое интернет-радио</span>
          <span>Город. Вечер. Музыка.</span>
        </footer>
      </motion.div>
    </div>,
    document.body
  );
}
