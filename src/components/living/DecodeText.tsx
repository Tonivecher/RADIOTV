import React, { useEffect, useRef, useState } from 'react';

interface DecodeTextProps {
  text: string;
  className?: string;
}

const SCRAMBLE_POOL = '·:+*#%░/\\<>0123456789abcdef';

/**
 * Scramble-and-lock character decoder adapted from KokonutUI DynamicText (decode mode).
 * Morphs genre tags left-to-right with brief phosphor highlights while respecting reduced-motion.
 */
export const DecodeText: React.FC<DecodeTextProps> = ({ text, className = '' }) => {
  const [rendered, setRendered] = useState(text);
  const [lockedCount, setLockedCount] = useState(text.length);
  const prevTextRef = useRef(text);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || document.hidden || prevTextRef.current === text) {
      prevTextRef.current = text;
      setRendered(text);
      setLockedCount(text.length);
      return;
    }

    prevTextRef.current = text;
    const chars = Array.from(text);
    const total = chars.length;
    const durationMs = Math.min(480, Math.max(240, total * 24));
    const startMs = performance.now();
    let raf = 0;
    let lastStep = 0;

    const tick = (nowMs: number) => {
      if (document.hidden) {
        setRendered(text);
        setLockedCount(total);
        return;
      }
      const progress = Math.min(1, (nowMs - startMs) / durationMs);
      const locked = Math.floor(progress * total);

      if (progress >= 1) {
        setRendered(text);
        setLockedCount(total);
        return;
      }

      if (nowMs - lastStep >= 36) {
        lastStep = nowMs;
        let out = '';
        for (let i = 0; i < total; i++) {
          const ch = chars[i];
          if (i < locked || ch === ' ' || ch === '·' || ch === '&') {
            out += ch;
          } else {
            out += SCRAMBLE_POOL[Math.floor(Math.random() * SCRAMBLE_POOL.length)];
          }
        }
        setRendered(out);
        setLockedCount(locked);
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [text]);

  const chars = Array.from(rendered);

  return (
    <span className={`decode-text ${className}`.trim()}>
      <span className="visually-hidden">{text}</span>
      <span aria-hidden="true" className="decode-text__visible">
        {chars.map((ch, idx) => (
          <span
            key={idx}
            className={
              idx >= lockedCount && ch !== ' ' ? 'decode-text__glyph is-scrambling' : 'decode-text__glyph'
            }
          >
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
};
