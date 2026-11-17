import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'framer-motion';

/** Keep the brand in view; mobile controls return as soon as scrolling reverses. */
export function AmbientHeader({ children }: { children: ReactNode }) {
  const { scrollY } = useScroll();
  const interaction = useMotionValue(0);
  const reduced = useReducedMotion();
  const header = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(
    () => window.matchMedia('(max-width: 760px)').matches
  );
  const [collapsed, setCollapsed] = useState(false);

  const target = useTransform([scrollY, interaction], ([scroll, active]) =>
    Number(active) ? 1 : 1 - Math.min(1, Math.max(0, Number(scroll)) / 320) * 0.24
  );
  const opacity = useSpring(target, { stiffness: 100, damping: 26 });

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
      className="island-header-wrap"
      data-collapsed={mobile && collapsed ? 'true' : undefined}
      style={{ opacity: mobile ? 1 : reduced ? target : opacity }}
      onPointerEnter={() => interaction.set(1)}
      onPointerLeave={(event) => {
        if (!event.currentTarget.querySelector(':focus-visible')) {
          interaction.set(0);
        }
      }}
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) {
          interaction.set(1);
          if (!event.target.classList.contains('island-header-expand')) {
            setCollapsed(false);
          }
        }
      }}
      onBlurCapture={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !event.currentTarget.matches(':hover')
        ) {
          interaction.set(0);
        }
      }}
    >
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
    </motion.header>
  );
}
