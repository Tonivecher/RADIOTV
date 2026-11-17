import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
} from 'framer-motion';
import { useSpatialMotion } from './SpatialMotion';

/** Keep the floating spatial header bar centered while gently drifting in 3D depth. */
export function AmbientHeader({ children }: { children: ReactNode }) {
  const { scrollY } = useScroll();
  const reduced = useReducedMotion();
  const { backgroundX, backgroundY, enabled } = useSpatialMotion();
  const header = useRef<HTMLElement>(null);
  const interactingRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const [mobile, setMobile] = useState(
    () => window.matchMedia('(max-width: 760px)').matches
  );
  const [collapsed, setCollapsed] = useState(false);
  const [scrolled, setScrolled] = useState(() => window.scrollY > 36);

  useEffect(() => {
    return scrollY.on('change', (v) => setScrolled(v > 36));
  }, [scrollY]);

  const targetX = useMotionValue(0);
  const targetY = useMotionValue(0);
  const floatX = useSpring(targetX, { stiffness: 55, damping: 26 });
  const floatY = useSpring(targetY, { stiffness: 55, damping: 26 });

  const syncFloatTargets = useCallback(() => {
    if (mobile || reduced) {
      targetX.set(0);
      targetY.set(0);
      return;
    }
    if (interactingRef.current) {
      return;
    }
    const baseX = enabled ? backgroundX.get() * 0.45 : 0;
    const baseY = enabled ? backgroundY.get() * 0.35 : 0;
    const scrollLift = -Math.min(4, (Math.max(0, scrollY.get()) / 360) * 4);
    targetX.set(baseX);
    targetY.set(baseY + scrollLift);
  }, [mobile, reduced, enabled, backgroundX, backgroundY, scrollY, targetX, targetY]);

  useEffect(() => {
    syncFloatTargets();
    const offX = backgroundX.on('change', syncFloatTargets);
    const offY = backgroundY.on('change', syncFloatTargets);
    const offScroll = scrollY.on('change', syncFloatTargets);
    return () => {
      offX();
      offY();
      offScroll();
    };
  }, [backgroundX, backgroundY, scrollY, syncFloatTargets]);

  const freezeFloat = () => {
    interactingRef.current = true;
    const settledX = floatX.get();
    const settledY = floatY.get();
    targetX.set(settledX);
    targetY.set(settledY);
    floatX.jump(settledX);
    floatY.jump(settledY);
  };

  const thawFloat = () => {
    if (
      pointerInsideRef.current ||
      header.current?.querySelector(':focus-visible')
    ) {
      return;
    }
    interactingRef.current = false;
    syncFloatTargets();
  };

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const change = () => {
      setMobile(query.matches);
      setCollapsed(false);
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (!mobile) {
      return;
    }
    let previous = Math.max(0, scrollY.get());
    let travel = 0;
    return scrollY.on('change', (value) => {
      const current = Math.max(0, value);
      const delta = current - previous;
      previous = current;
      if (current < 35) {
        travel = 0;
        setCollapsed(false);
        return;
      }
      if (!delta) {
        return;
      }
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel < -8) {
        setCollapsed(false);
      }
      if (
        travel > 16 &&
        current > 90 &&
        !header.current?.querySelector(':focus-visible')
      ) {
        setCollapsed(true);
      }
    });
  }, [mobile, scrollY]);

  useEffect(() => {
    const controls = header.current?.querySelectorAll<HTMLElement>(
      '.island-channels, .island-actions'
    );
    controls?.forEach((element) => {
      element.inert = mobile && collapsed;
    });
    return () => {
      controls?.forEach((element) => {
        element.inert = false;
      });
    };
  }, [mobile, collapsed]);

  return (
    <motion.header
      ref={header}
      className={`island-header-wrap${scrolled ? ' is-scrolled' : ''}`}
      data-collapsed={mobile && collapsed ? 'true' : undefined}
      onPointerEnter={() => {
        pointerInsideRef.current = true;
        freezeFloat();
      }}
      onPointerDownCapture={freezeFloat}
      onPointerLeave={() => {
        pointerInsideRef.current = false;
        thawFloat();
      }}
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) {
          freezeFloat();
          if (!event.target.classList.contains('island-header-expand')) {
            setCollapsed(false);
          }
        }
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          queueMicrotask(thawFloat);
        }
      }}
    >
      <motion.div
        className="island-header-float"
        style={reduced || mobile ? undefined : { x: floatX, y: floatY }}
      >
        <div className="island-header-shell">
          {children}
          <button
            type="button"
            className="island-header-expand"
            aria-label="Показать управление радио"
            aria-expanded={!collapsed}
            onClick={() => {
              setCollapsed(false);
              requestAnimationFrame(() =>
                header.current
                  ?.querySelector<HTMLButtonElement>('.island-channels button')
                  ?.focus({ preventScroll: true })
              );
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="m7 10 5 5 5-5" />
            </svg>
          </button>
        </div>
      </motion.div>
    </motion.header>
  );
}
