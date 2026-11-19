import React, { useEffect, useRef, useState } from 'react';
import { BlindMaskIcon } from '../icons/RadioIcons';

interface InteractiveNoteProps {
  title: string;
  body: string;
  secretHint?: string;
}

interface DustSpeck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  size: number;
}

/**
 * Interactive "Listen without a tracklist" card combining KokonutUI MarkerText (hand-drawn underline)
 * and SpoilerText (shimmering dust veil over a hidden secret ether note that disperses on click/hover).
 */
export const InteractiveNote: React.FC<InteractiveNoteProps> = ({
  title,
  body,
  secretHint = 'Сет без метаданных · ловите момент на слух',
}) => {
  const [revealed, setRevealed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (revealed) return;
    const canvas = canvasRef.current;
    const badge = badgeRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !badge || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let specks: DustSpeck[] = [];
    let raf = 0;
    let onScreen = true;
    let accent = '#e7bb94';

    const readAccent = () => {
      accent =
        getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() ||
        '#e7bb94';
    };

    const layout = () => {
      const rect = badge.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(180, Math.max(48, Math.round((width * height) / 28)));
      specks = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 9,
        vy: (Math.random() - 0.5) * 9,
        phase: Math.random() * Math.PI * 2,
        size: Math.random() < 0.28 ? 1.6 : 1.1,
      }));
    };

    let last = performance.now();
    const tick = (now: number) => {
      raf = 0;
      if (!onScreen || document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = accent;

      for (const s of specks) {
        if (!reduced) {
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.phase += dt * 3.1;
          if (s.x < 2 || s.x > width - 2) s.vx = -s.vx;
          if (s.y < 2 || s.y > height - 2) s.vy = -s.vy;
        }
        const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(s.phase));
        ctx.globalAlpha = twinkle * 0.72;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
      ctx.globalAlpha = 1;
      if (!reduced) {
        raf = window.requestAnimationFrame(tick);
      }
    };

    const start = () => {
      if (!raf && onScreen && !document.hidden) {
        last = performance.now();
        raf = window.requestAnimationFrame(tick);
      }
    };

    readAccent();
    layout();
    tick(performance.now());

    const ro = new ResizeObserver(() => {
      layout();
      tick(performance.now());
    });
    ro.observe(badge);

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      if (onScreen) start();
      else {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(badge);

    const onVis = () => {
      if (!document.hidden && onScreen) start();
      else {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    document.addEventListener('visibilitychange', onVis);

    const themeObs = new MutationObserver(() => {
      readAccent();
      if (reduced) tick(performance.now());
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      themeObs.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [revealed]);

  return (
    <div
      className={`security-glass-note interactive-note ${hovered ? 'is-hovered' : ''}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <span className="interactive-note__icon">
        <BlindMaskIcon size={20} />
      </span>
      <div className="interactive-note__body">
        <strong className="interactive-note__title">
          <span className="marker-underline">
            {title}
            <svg
              aria-hidden="true"
              className="marker-underline__svg"
              viewBox="0 0 180 10"
              preserveAspectRatio="none"
            >
              <path
                d="M2 7 C42 3, 128 9, 178 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </strong>
        <p>{body}</p>
        <button
          ref={badgeRef}
          type="button"
          className={`spoiler-veil ${revealed ? 'is-revealed' : ''}`}
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
          title={revealed ? 'Скрыть эфирную заметку' : 'Нажмите, чтобы рассеять завесу'}
        >
          <span className="spoiler-veil__text">{secretHint}</span>
          {!revealed && <canvas ref={canvasRef} className="spoiler-veil__canvas" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
};
