import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';

interface HoldResetButtonProps {
  onConfirm: () => void;
  label?: string;
  holdingLabel?: string;
  completeLabel?: string;
  holdDurationMs?: number;
  className?: string;
}

/**
 * Tactile hold-to-confirm reset button adapted from KokonutUI HoldButton.
 * Press & hold (~550ms) sweeps an optical accent fill; double-click also confirms immediately.
 */
export const HoldResetButton: React.FC<HoldResetButtonProps> = ({
  onConfirm,
  label = 'Сбросить',
  holdingLabel = 'Держите…',
  completeLabel = 'Сброшено',
  holdDurationMs = 560,
  className = '',
}) => {
  const reducedMotion = Boolean(useReducedMotion());
  const [phase, setPhase] = useState<'idle' | 'holding' | 'complete'>('idle');
  const phaseRef = useRef<'idle' | 'holding' | 'complete'>('idle');
  const progress = useMotionValue(0);
  const animRef = useRef<ReturnType<typeof animate> | null>(null);
  const resetTimerRef = useRef<number | undefined>(undefined);
  const clipPath = useTransform(progress, (p) => `inset(0 ${(1 - p) * 100}% 0 0)`);

  useEffect(() => {
    return () => {
      animRef.current?.stop();
      window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const triggerComplete = () => {
    animRef.current?.stop();
    phaseRef.current = 'complete';
    setPhase('complete');
    progress.set(1);
    onConfirm();
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      progress.set(0);
      phaseRef.current = 'idle';
      setPhase('idle');
    }, 1100);
  };

  const startHold = () => {
    if (phaseRef.current !== 'idle') return;
    phaseRef.current = 'holding';
    setPhase('holding');
    animRef.current?.stop();
    const remaining = (1 - progress.get()) * (reducedMotion ? 160 : holdDurationMs);
    animRef.current = animate(progress, 1, {
      duration: remaining / 1000,
      ease: 'linear',
      onComplete: () => {
        if (phaseRef.current === 'holding') {
          triggerComplete();
        }
      },
    });
  };

  const cancelHold = () => {
    if (phaseRef.current !== 'holding') return;
    phaseRef.current = 'idle';
    setPhase('idle');
    animRef.current?.stop();
    animRef.current = animate(progress, 0, {
      duration: reducedMotion ? 0 : Math.max(0.12, progress.get() * 0.28),
      ease: [0.23, 1, 0.32, 1],
    });
  };

  return (
    <button
      type="button"
      className={`glass-pill-btn hold-reset-btn ${phase === 'complete' ? 'is-complete' : ''} ${className}`.trim()}
      title="Зажмите или нажмите дважды для сброса настроек эквалайзера"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        startHold();
      }}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onDoubleClick={(e) => {
        e.preventDefault();
        triggerComplete();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          startHold();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          cancelHold();
        }
      }}
      onBlur={cancelHold}
    >
      <motion.span
        aria-hidden="true"
        className="hold-reset-btn__fill"
        style={{ clipPath }}
      />
      <span className="hold-reset-btn__label">
        {phase === 'holding' ? holdingLabel : phase === 'complete' ? completeLabel : label}
      </span>
    </button>
  );
};
