import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { safeStorage } from '../utils/storage';

type SensorStatus =
  | 'gesture'
  | 'off'
  | 'requesting'
  | 'waiting'
  | 'on'
  | 'denied'
  | 'unavailable';

type MotionState = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  backgroundX: MotionValue<number>;
  backgroundY: MotionValue<number>;
  enabled: boolean;
  visible: boolean;
  sensorStatus: SensorStatus;
  sensorWanted: boolean;
  motionPaused: boolean;
  toggleSensor: () => void;
  prepareSensorPermission: () => void;
  setBackgroundPaused: (paused: boolean) => void;
};

const SpatialContext = createContext<MotionState | null>(null);

export function useSpatialMotion() {
  const ctx = useContext(SpatialContext);
  if (!ctx) {
    throw new Error('useSpatialMotion must be used within SpatialMotionProvider');
  }
  return ctx;
}

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

type OrientationConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

export function SpatialMotionProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [fine, setFine] = useState(
    () => window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
  const [visible, setVisible] = useState(!document.hidden);
  const [backgroundPaused, setBackgroundPaused] = useState(
    () => safeStorage.getItem('radiotv_video_paused') === '1'
  );
  const [sensorWanted, setSensorWanted] = useState(
    () =>
      window.matchMedia('(pointer: coarse)').matches &&
      safeStorage.getItem('radiotv_tilt_enabled') !== '0'
  );
  const [permissionGranted, setPermissionGranted] = useState(() => {
    const orientation = window.DeviceOrientationEvent as OrientationConstructor | undefined;
    return Boolean(orientation) && typeof orientation?.requestPermission !== 'function';
  });

  const permissionGrantedRef = useRef(permissionGranted);
  const permissionPending = useRef(false);
  const [sensorAvailable, setSensorAvailable] = useState(true);
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>(() =>
    !sensorWanted ? 'off' : permissionGranted ? 'waiting' : 'gesture'
  );
  const permissionAttempt = useRef(0);
  const mounted = useRef(true);

  const x = useMotionValue(window.innerWidth / 2);
  const y = useMotionValue(window.innerHeight / 2);
  const smoothX = useSpring(x, { stiffness: 60, damping: 24 });
  const smoothY = useSpring(y, { stiffness: 60, damping: 24 });

  const bx = useMotionValue(0);
  const by = useMotionValue(0);
  const scrollDepth = useMotionValue(0);
  const combinedY = useTransform([by, scrollDepth], ([tilt, scroll]) =>
    clamp(Number(tilt) + Number(scroll), 32)
  );
  const backgroundX = useSpring(bx, { stiffness: 30, damping: 24 });
  const backgroundY = useSpring(combinedY, { stiffness: 30, damping: 24 });

  const enabled = fine && !reduced && visible;
  const motionPaused = Boolean(reduced) || !visible || backgroundPaused;

  useEffect(() => {
    mounted.current = true;
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setFine(query.matches);
    const visibility = () => setVisible(!document.hidden);
    query.addEventListener('change', update);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      permissionAttempt.current += 1;
      query.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  const requestSensorPermission = (wanted = sensorWanted) => {
    if (
      !wanted ||
      permissionGrantedRef.current ||
      permissionPending.current ||
      motionPaused
    ) {
      return;
    }
    const orientation = window.DeviceOrientationEvent as OrientationConstructor | undefined;
    if (!window.isSecureContext || !orientation) {
      setSensorAvailable(false);
      setSensorStatus('unavailable');
      return;
    }
    if (typeof orientation.requestPermission !== 'function') {
      return;
    }

    const attempt = ++permissionAttempt.current;
    permissionPending.current = true;
    setSensorStatus('requesting');

    const finish = (permission: PermissionState) => {
      if (!mounted.current || attempt !== permissionAttempt.current) {
        return;
      }
      permissionPending.current = false;
      if (permission !== 'granted') {
        setSensorStatus('denied');
        return;
      }
      permissionGrantedRef.current = true;
      setPermissionGranted(true);
      setSensorAvailable(true);
      setSensorStatus('waiting');
    };

    // Both the boot entry and the toggle call this synchronously from their click.
    try {
      void orientation
        .requestPermission()
        .then(finish)
        .catch(() => finish('denied'));
    } catch {
      finish('denied');
    }
  };

  const prepareSensorPermission = () => requestSensorPermission();

  const toggleSensor = () => {
    if (sensorWanted) {
      permissionAttempt.current += 1;
      permissionPending.current = false;
      safeStorage.setItem('radiotv_tilt_enabled', '0');
      setSensorWanted(false);
      setSensorStatus('off');
      return;
    }
    if (motionPaused) {
      return;
    }
    safeStorage.setItem('radiotv_tilt_enabled', '1');
    setSensorWanted(true);
    setSensorAvailable(true);
    setSensorStatus(permissionGrantedRef.current ? 'waiting' : 'gesture');
    requestSensorPermission(true);
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let width = window.innerWidth;
    let height = window.innerHeight;

    const leave = () => {
      x.set(width / 2);
      y.set(height / 2);
      bx.set(0);
      by.set(0);
    };
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      leave();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
        return;
      }
      x.set(event.clientX);
      y.set(event.clientY);
      if (!backgroundPaused && !sensorWanted) {
        bx.set(clamp((event.clientX / width - 0.5) * -16, 8));
        by.set(clamp((event.clientY / height - 0.5) * -12, 6));
      }
    };

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('blur', leave);
    document.addEventListener('pointerleave', leave);
    return () => {
      leave();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', leave);
      document.removeEventListener('pointerleave', leave);
    };
  }, [enabled, backgroundPaused, sensorWanted, x, y, bx, by]);

  useEffect(() => {
    if (motionPaused || fine) {
      scrollDepth.set(0);
      return;
    }
    const update = () =>
      scrollDepth.set(
        -Math.min(1, Math.max(0, window.scrollY) / (window.innerHeight * 2)) * 24
      );
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [motionPaused, fine, scrollDepth]);

  useEffect(() => {
    if (!sensorWanted || motionPaused) {
      bx.set(0);
      by.set(0);
      return;
    }
    if (!window.isSecureContext || !window.DeviceOrientationEvent) {
      setSensorStatus('unavailable');
      setSensorAvailable(false);
      return;
    }
    if (!permissionGranted || !sensorAvailable) {
      return;
    }

    let baseline: { beta: number; gamma: number } | null = null;
    setSensorStatus('waiting');
    const timeout = window.setTimeout(() => {
      setSensorStatus('unavailable');
      setSensorAvailable(false);
    }, 3000);

    const reset = () => {
      baseline = null;
      bx.set(0);
      by.set(0);
    };
    const orient = (event: DeviceOrientationEvent) => {
      if (
        event.beta === null ||
        event.gamma === null ||
        !Number.isFinite(event.beta) ||
        !Number.isFinite(event.gamma)
      ) {
        return;
      }
      if (!baseline) {
        baseline = { beta: event.beta, gamma: event.gamma };
      }
      window.clearTimeout(timeout);
      setSensorStatus('on');
      const beta = clamp(event.beta - baseline.beta, 24);
      const gamma = clamp(event.gamma - baseline.gamma, 24);
      const angle =
        ((window.screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
      bx.set(clamp((gamma * Math.cos(angle) + beta * Math.sin(angle)) * -0.5, 12));
      by.set(clamp((beta * Math.cos(angle) - gamma * Math.sin(angle)) * -0.35, 8));
    };

    window.addEventListener('deviceorientation', orient, { passive: true });
    window.addEventListener('orientationchange', reset);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('deviceorientation', orient);
      window.removeEventListener('orientationchange', reset);
      reset();
    };
  }, [sensorWanted, motionPaused, permissionGranted, sensorAvailable, bx, by]);

  useEffect(() => {
    if (motionPaused) {
      bx.set(0);
      by.set(0);
      scrollDepth.set(0);
      if (reduced || !visible) {
        backgroundX.jump(0);
        backgroundY.jump(0);
      }
    }
  }, [motionPaused, reduced, visible, bx, by, scrollDepth, backgroundX, backgroundY]);

  return (
    <SpatialContext.Provider
      value={{
        x: smoothX,
        y: smoothY,
        backgroundX,
        backgroundY,
        enabled,
        visible,
        sensorStatus,
        sensorWanted,
        motionPaused,
        toggleSensor,
        prepareSensorPermission,
        setBackgroundPaused,
      }}
    >
      <div className="motion-world" data-motion={enabled ? 'on' : 'off'}>
        {children}
      </div>
    </SpatialContext.Provider>
  );
}

const SENSOR_COPY: Record<SensorStatus, string> = {
  gesture: 'Нажмите «Войти», чтобы разрешить движение фона',
  off: 'Наклон выключен',
  requesting: 'Запрашиваем доступ к движению',
  waiting: 'Ждём данные датчиков',
  on: 'Фон реагирует на наклон',
  denied: 'Доступ к движению запрещён. Проверьте настройки браузера.',
  unavailable: 'Датчики движения недоступны. Параллакс при прокрутке работает.',
};

export function BackgroundMotionControl() {
  const { sensorStatus, sensorWanted, motionPaused, toggleSensor } = useSpatialMotion();
  const status = motionPaused
    ? 'Движение фона приостановлено'
    : SENSOR_COPY[sensorStatus];
  const showStatus =
    !motionPaused &&
    ['gesture', 'requesting', 'waiting', 'denied', 'unavailable'].includes(sensorStatus);

  return (
    <div className="background-motion-control">
      <button
        type="button"
        className="background-toggle background-motion-toggle"
        onClick={toggleSensor}
        aria-pressed={sensorWanted}
        aria-label={sensorWanted ? 'Выключить наклон фона' : 'Включить наклон фона'}
        title={status}
        disabled={motionPaused && !sensorWanted}
        aria-busy={sensorStatus === 'requesting'}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <rect x="7" y="3" width="10" height="18" rx="3" transform="rotate(-14 12 12)" />
          <path d="m3 9-1 3 2 2m17-5 1 3-2 2M11 17h2" />
        </svg>
        <span>Наклон</span>
      </button>
      <span
        className={showStatus ? 'background-motion-status' : 'visually-hidden'}
        role="status"
      >
        {status}
      </span>
    </div>
  );
}

let panelSequence = 0;

/** Drift, depth and hover tilt own separate transform layers. No render follows pointermove. */
export function FloatPanel({
  children,
  className = '',
  depth = 1,
  'aria-label': label,
}: {
  children: ReactNode;
  className?: string;
  depth?: number;
} & Pick<HTMLAttributes<HTMLDivElement>, 'aria-label'>) {
  const { x, y, enabled, visible } = useSpatialMotion();
  const root = useRef<HTMLDivElement>(null);
  const bounds = useRef<DOMRect | null>(null);
  const frozen = useRef(false);
  const hovered = useRef(false);
  const updateTargets = useRef<() => void>(() => {});
  const [inView, setInView] = useState(true);
  const [phase] = useState(() => ++panelSequence);

  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const smoothTx = useSpring(tx, { stiffness: 80, damping: 24 });
  const smoothTy = useSpring(ty, { stiffness: 80, damping: 24 });
  const smoothRx = useSpring(rx, { stiffness: 96, damping: 25 });
  const smoothRy = useSpring(ry, { stiffness: 96, damping: 25 });

  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '60px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!enabled) {
      updateTargets.current = () => {};
      tx.set(0);
      ty.set(0);
      rx.set(0);
      ry.set(0);
      return;
    }
    const update = () => {
      if (!inView || frozen.current) {
        return;
      }
      tx.set((x.get() / window.innerWidth - 0.5) * depth * 5);
      ty.set((y.get() / window.innerHeight - 0.5) * depth * 4);
      const b = bounds.current;
      if (b && hovered.current) {
        ry.set(Math.max(-2, Math.min(2, ((x.get() - b.left - b.width / 2) / b.width) * 4)));
        rx.set(Math.max(-2, Math.min(2, (-(y.get() - b.top - b.height / 2) / b.height) * 4)));
      }
    };
    updateTargets.current = update;
    update();
    const offX = x.on('change', update);
    const offY = y.on('change', update);
    return () => {
      updateTargets.current = () => {};
      offX();
      offY();
    };
  }, [enabled, inView, x, y, tx, ty, rx, ry, depth]);

  const freeze = () => {
    frozen.current = true;
    root.current?.setAttribute('data-frozen', 'true');
  };

  const thaw = () => {
    if (
      root.current?.matches(':focus-within') ||
      root.current?.hasAttribute('data-dragging')
    ) {
      return;
    }
    frozen.current = false;
    root.current?.removeAttribute('data-frozen');
    if (!hovered.current) {
      rx.set(0);
      ry.set(0);
    }
    updateTargets.current();
  };

  const dragCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    const leave = () => {
      hovered.current = false;
      bounds.current = null;
      rx.set(0);
      ry.set(0);
    };
    window.addEventListener('blur', leave);
    return () => {
      window.removeEventListener('blur', leave);
      dragCleanup.current?.();
    };
  }, [rx, ry]);

  const beginDrag = () => {
    dragCleanup.current?.();
    root.current?.setAttribute('data-dragging', 'true');
    freeze();
    const finish = () => {
      root.current?.removeAttribute('data-dragging');
      thaw();
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', finish);
      dragCleanup.current = null;
    };
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('blur', finish);
    dragCleanup.current = () => {
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', finish);
    };
  };

  const slotClasses = className
    .split(' ')
    .filter(Boolean)
    .map((s) => `float-slot--${s}`)
    .join(' ');

  return (
    <div
      ref={root}
      aria-label={label}
      className={`float-slot ${slotClasses}`.trim()}
      data-paused={!enabled || !visible || !inView ? 'true' : undefined}
      onPointerEnter={() => {
        if (enabled && root.current) {
          bounds.current = root.current.getBoundingClientRect();
        }
        hovered.current = true;
      }}
      onPointerLeave={() => {
        hovered.current = false;
        if (!frozen.current) {
          rx.set(0);
          ry.set(0);
        }
      }}
      onFocusCapture={freeze}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          queueMicrotask(thaw);
        }
      }}
      onPointerDownCapture={beginDrag}
      onPointerUpCapture={() => {
        root.current?.removeAttribute('data-dragging');
        thaw();
      }}
      onPointerCancelCapture={() => {
        root.current?.removeAttribute('data-dragging');
        thaw();
      }}
    >
      <div
        className={`float-drift float-drift--${phase % 3}`}
        style={{
          animationDelay: `-${phase * 3.71}s`,
          animationDuration: `${17 + (phase % 5) * 2.3}s`,
        }}
      >
        <motion.div style={{ x: smoothTx, y: smoothTy }}>
          <motion.div
            className={className}
            style={{
              rotateX: smoothRx,
              rotateY: smoothRy,
              transformPerspective: 1100,
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

export function MagneticMark({ children }: { children: ReactNode }) {
  const { backgroundX, backgroundY, enabled } = useSpatialMotion();
  const x = useTransform(backgroundX, (v) => (enabled ? -v * 1.7 : 0));
  const y = useTransform(backgroundY, (v) => (enabled ? -v * 1.7 : 0));
  const rotate = useTransform(backgroundX, (v) => (enabled ? -v * 0.9 : 0));

  return (
    <motion.span className="magnetic-mark" style={{ x, y, rotate }}>
      {children}
    </motion.span>
  );
}
