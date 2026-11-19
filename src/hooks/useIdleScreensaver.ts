import { useEffect, useRef, useState } from 'react';

interface UseIdleScreensaverOptions {
  enabled: boolean;
  /** Inactivity threshold before entering screensaver mode (default: 9 seconds). */
  timeoutMs?: number;
}

const DEFAULT_IDLE_MS = 9 * 1000;
const POINTER_MOVE_THRESHOLD_PX = 3;

/**
 * Tracks user inactivity while on the live radio stage.
 * After `timeoutMs` without pointer/touch/keyboard/wheel activity, enters screensaver mode
 * (leaving only the background, radio title, and live waveform). Any real movement wakes UI instantly.
 */
export function useIdleScreensaver({
  enabled,
  timeoutMs = DEFAULT_IDLE_MS,
}: UseIdleScreensaverOptions): boolean {
  const [isIdle, setIsIdle] = useState(false);
  const idleRef = useRef(false);
  idleRef.current = isIdle;

  useEffect(() => {
    if (!enabled) {
      setIsIdle(false);
      return;
    }

    let timer: number | undefined;
    let lastPointerX: number | null = null;
    let lastPointerY: number | null = null;
    let ignoreScrollUntil = 0;

    const isEditingField = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };

    const scheduleIdle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (
          document.hidden ||
          isEditingField() ||
          document.documentElement.hasAttribute('data-globe-drag')
        ) {
          scheduleIdle();
          return;
        }
        if (window.scrollY > 48) {
          ignoreScrollUntil = Date.now() + 1200;
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        setIsIdle(true);
      }, timeoutMs);
    };

    const wake = () => {
      if (idleRef.current) {
        setIsIdle(false);
      }
      scheduleIdle();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (lastPointerX !== null && lastPointerY !== null) {
        const dx = e.clientX - lastPointerX;
        const dy = e.clientY - lastPointerY;
        if (dx * dx + dy * dy < POINTER_MOVE_THRESHOLD_PX * POINTER_MOVE_THRESHOLD_PX) {
          return;
        }
      }
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      wake();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (lastPointerX !== null && lastPointerY !== null) {
        const dx = e.clientX - lastPointerX;
        const dy = e.clientY - lastPointerY;
        if (dx * dx + dy * dy < POINTER_MOVE_THRESHOLD_PX * POINTER_MOVE_THRESHOLD_PX) {
          return;
        }
      }
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      wake();
    };

    const onScroll = () => {
      if (Date.now() < ignoreScrollUntil) {
        return;
      }
      wake();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        scheduleIdle();
      }
    };

    scheduleIdle();

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('touchstart', wake, { passive: true });
    window.addEventListener('wheel', wake, { passive: true });
    window.addEventListener('keydown', wake);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('touchstart', wake);
      window.removeEventListener('wheel', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, timeoutMs]);

  return isIdle;
}
