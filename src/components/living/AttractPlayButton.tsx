import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

interface AttractPlayButtonProps {
  isPlaying: boolean;
  onClick: () => void;
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
}

interface Filing {
  x: number;
  y: number;
  restX: number;
  restY: number;
  inX: number;
  inY: number;
  t: number;
  fade: number;
  len: number;
  theta: number;
  omega: number;
  near: number;
}

interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  age: number;
}

const RADIUS = 46;
const SPACING = 14;
const FILING_LEN = 6.5;
const CLEARANCE = 6;
const STIFFNESS = 220;
const DAMPING = 20;
const HALF_PI = Math.PI / 2;

const hash = (x: number, y: number, seed: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

const smoothstep = (a: number, b: number, v: number) => {
  const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

const lineDelta = (target: number, current: number) => {
  const d = (target - current + HALF_PI) % Math.PI;
  return (d < 0 ? d + Math.PI : d) - HALF_PI;
};

/**
 * Hero Play/Pause CTA wrapped in a magnetic field of radial force strokes (AttractButton)
 * plus a click particle burst (ParticleButton), synced to active theme accent.
 */
export const AttractPlayButton: React.FC<AttractPlayButtonProps> = ({
  isPlaying,
  onClick,
  ariaLabel,
  className = '',
  children,
}) => {
  const reducedMotion = Boolean(useReducedMotion());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const burstRef = useRef<BurstParticle[]>([]);
  const kickRef = useRef<() => void>(() => {});
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  focusedRef.current = focused;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!wrapper || !canvas || !ctx) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = motionQuery.matches;
    let visible = !document.hidden;
    let onScreen = true;
    let width = 0;
    let height = 0;
    let filings: Filing[] = [];
    let box = { left: 0, top: 0, right: 0, bottom: 0, cx: 0, cy: 0 };
    let accent = '#e7bb94';
    let raf = 0;
    let last = 0;
    const pointer = { x: 0, y: 0 };
    let presence = 0;
    let presenceTarget = 0;
    let pull = 0;
    let pullTarget = 0;

    const readAccent = () => {
      accent =
        getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() ||
        '#e7bb94';
    };

    const layout = () => {
      const bw = wrapper.offsetWidth || 218;
      const bh = wrapper.offsetHeight || 58;
      width = bw + RADIUS * 2;
      height = bh + RADIUS * 2;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      box = {
        left: RADIUS,
        top: RADIUS,
        right: RADIUS + bw,
        bottom: RADIUS + bh,
        cx: RADIUS + bw / 2,
        cy: RADIUS + bh / 2,
      };

      const poleOffset = Math.max(bw / 2 - bh / 3, bw / 4);
      const nx = box.cx + poleOffset;
      const sx = box.cx - poleOffset;

      filings = [];
      const cols = Math.ceil(width / SPACING);
      const rows = Math.ceil(height / SPACING);
      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const x = col * SPACING + (hash(col, row, 1) - 0.5) * SPACING * 0.45;
          const y = row * SPACING + (hash(col, row, 2) - 0.5) * SPACING * 0.45;
          const dx = Math.max(box.left - x, 0, x - box.right);
          const dy = Math.max(box.top - y, 0, y - box.bottom);
          const edge = Math.hypot(dx, dy);
          const t = edge / RADIUS;
          if (edge < CLEARANCE || t > 1) continue;

          const ndx = x - nx;
          const ndy = y - box.cy;
          const sdx = x - sx;
          const sdy = y - box.cy;
          const nd3 = Math.max(Math.hypot(ndx, ndy) ** 3, 1);
          const sd3 = Math.max(Math.hypot(sdx, sdy) ** 3, 1);
          const rest = Math.atan2(ndy / nd3 - sdy / sd3, ndx / nd3 - sdx / sd3);

          const cdx = box.cx - x;
          const cdy = box.cy - y;
          const cd = Math.hypot(cdx, cdy) || 1;

          filings.push({
            x,
            y,
            restX: Math.cos(rest * 2),
            restY: Math.sin(rest * 2),
            inX: cdx / cd,
            inY: cdy / cd,
            t,
            fade: 1 - smoothstep(0.35, 1, t),
            len: FILING_LEN * (0.8 + hash(col, row, 3) * 0.4),
            theta: rest,
            omega: 0,
            near: 0,
          });
        }
      }
    };

    const targetAngle = (f: Filing, nowSec: number) => {
      let vx = f.restX;
      let vy = f.restY;
      f.near = 0;

      if (isPlayingRef.current && presence < 0.05 && pull < 0.05) {
        const ripple = Math.sin(nowSec * 2.2 - f.t * 4.5 + f.x * 0.04) * 0.22;
        const a = Math.atan2(vy, vx) + ripple;
        vx = Math.cos(a);
        vy = Math.sin(a);
      }

      if (pull > 0.001) {
        const w = pull * 0.65 * (1 - f.t * 0.38);
        const a = Math.atan2(f.inY, f.inX) * 2;
        vx = vx * (1 - w) + Math.cos(a) * w;
        vy = vy * (1 - w) + Math.sin(a) * w;
      }

      if (presence > 0.001) {
        const dx = pointer.x - f.x;
        const dy = pointer.y - f.y;
        const sigma = RADIUS * 0.85;
        const w = presence * 0.92 * Math.exp(-(dx * dx + dy * dy) / (sigma * sigma));
        f.near = w;
        if (w > 0.001) {
          const a = Math.atan2(dy, dx) * 2;
          vx = vx * (1 - w) + Math.cos(a) * w;
          vy = vy * (1 - w) + Math.sin(a) * w;
        }
      }

      return Math.atan2(vy, vx) / 2;
    };

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      ctx.lineWidth = 1.25;
      ctx.lineCap = 'round';

      const baseAlpha = isPlayingRef.current ? 0.32 : 0.22;
      for (const f of filings) {
        const alpha = f.fade * (baseAlpha + f.near * 0.48 + pull * 0.28);
        if (alpha < 0.015) continue;
        const shift = pull * 3.2 * (1 - f.t);
        const x = f.x + f.inX * shift;
        const y = f.y + f.inY * shift;
        const hx = (Math.cos(f.theta) * f.len) / 2;
        const hy = (Math.sin(f.theta) * f.len) / 2;
        ctx.globalAlpha = Math.min(0.88, alpha);
        ctx.beginPath();
        ctx.moveTo(x - hx, y - hy);
        ctx.lineTo(x + hx, y + hy);
        ctx.stroke();
      }

      const particles = burstRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        p.vx *= 1 - 2.6 * dt;
        p.vy *= 1 - 2.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const prog = p.age / p.life;
        ctx.globalAlpha = (1 - prog * prog) * 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - prog * 0.45), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const ease = (value: number, target: number, dt: number, tau: number) => {
      const next = value + (target - value) * (1 - Math.exp(-dt / tau));
      return Math.abs(target - next) < 0.002 ? target : next;
    };

    const step = (now: number) => {
      raf = 0;
      if (reduced || !visible || !onScreen) return;
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      presence = ease(presence, presenceTarget, dt, 0.07);
      pull = ease(pull, pullTarget, dt, 0.09);

      let active =
        presence !== presenceTarget ||
        pull !== pullTarget ||
        burstRef.current.length > 0 ||
        isPlayingRef.current;

      const nowSec = now * 0.001;
      for (const f of filings) {
        const diff = lineDelta(targetAngle(f, nowSec), f.theta);
        f.omega += (STIFFNESS * diff - DAMPING * f.omega) * dt;
        f.theta += f.omega * dt;
        if (Math.abs(diff) > 0.004 || Math.abs(f.omega) > 0.03) {
          active = true;
        }
      }

      draw(dt);
      if (active) {
        raf = window.requestAnimationFrame(step);
      }
    };

    const kick = () => {
      if (reduced || !visible || !onScreen || raf) return;
      last = performance.now();
      raf = window.requestAnimationFrame(step);
    };
    kickRef.current = kick;

    const onMove = (e: PointerEvent) => {
      if (reduced || !visible || !onScreen || e.pointerType === 'touch') return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inField = x >= 0 && y >= 0 && x <= width && y <= height;
      const inBtn = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      if (inField) {
        pointer.x = x;
        pointer.y = y;
      }
      const nextPresence = inField ? 1 : 0;
      const nextPull = inBtn || focusedRef.current ? 1 : 0;
      if (inField || nextPresence !== presenceTarget || nextPull !== pullTarget) {
        presenceTarget = nextPresence;
        pullTarget = nextPull;
        kick();
      }
    };

    const onLeave = () => {
      presenceTarget = 0;
      pullTarget = focusedRef.current ? 1 : 0;
      kick();
    };

    const onVisibility = () => {
      visible = !document.hidden;
      if (visible && onScreen && (isPlayingRef.current || presenceTarget > 0 || pullTarget > 0)) {
        kick();
      } else if (!visible && raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const onMotionChange = () => {
      reduced = motionQuery.matches;
      if (reduced && raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
      draw(0);
    };

    readAccent();
    layout();
    draw(0);
    if (isPlayingRef.current) kick();

    const ro = new ResizeObserver(() => {
      layout();
      draw(0);
    });
    ro.observe(wrapper);

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      if (onScreen && visible && isPlayingRef.current) kick();
    });
    io.observe(wrapper);

    const themeObs = new MutationObserver(() => {
      readAccent();
      draw(0);
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    motionQuery.addEventListener('change', onMotionChange);

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      themeObs.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotionChange);
      kickRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    if (isPlaying) {
      kickRef.current();
    }
  }, [isPlaying]);

  const spawnBurst = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (reducedMotion || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const ox =
      e.clientX > 0 ? e.clientX - rect.left + RADIUS : rect.width * 0.5 + RADIUS;
    const oy =
      e.clientY > 0 ? e.clientY - rect.top + RADIUS : rect.height * 0.5 + RADIUS;

    for (let i = 0; i < 16; i++) {
      const angle = (Math.PI * 2 * i) / 16 + (Math.random() - 0.5) * 0.35;
      const speed = 75 + Math.random() * 115;
      burstRef.current.push({
        x: ox,
        y: oy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1.5 + Math.random() * 1.8,
        life: 0.45 + Math.random() * 0.25,
        age: 0,
      });
    }
    kickRef.current();
  };

  return (
    <div ref={wrapperRef} className="attract-cta-wrap">
      <span
        aria-hidden="true"
        className="attract-cta-field"
        style={{ inset: -RADIUS }}
      >
        <canvas ref={canvasRef} className="attract-cta-canvas" />
      </span>
      <motion.button
        whileHover={{ scale: reducedMotion ? 1 : 1.03 }}
        whileTap={{ scale: reducedMotion ? 1 : 0.96 }}
        type="button"
        className={className}
        onClick={(e) => {
          spawnBurst(e);
          onClick();
        }}
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        aria-label={ariaLabel}
      >
        {children}
      </motion.button>
    </div>
  );
};
