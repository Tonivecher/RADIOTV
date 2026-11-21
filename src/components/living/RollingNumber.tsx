import React, { useRef } from 'react';

interface RollingNumberProps {
  value: string;
  className?: string;
}

/**
 * Lightweight split-flap / rolling counter digits with tabular numerals.
 * Only animates individual digit slots that actually changed, zero layout shift.
 */
export const RollingNumber: React.FC<RollingNumberProps> = ({ value, className = '' }) => {
  const prevCharsRef = useRef<string[]>([]);
  const flipSeqRef = useRef<number[]>([]);

  const chars = Array.from(value);
  const prev = prevCharsRef.current;

  const seqs = chars.map((ch, i) => {
    const prevSeq = flipSeqRef.current[i] ?? 0;
    if (prev[i] !== undefined && prev[i] !== ch) {
      return prevSeq + 1;
    }
    return prevSeq;
  });

  prevCharsRef.current = chars;
  flipSeqRef.current = seqs;

  return (
    <span className={`rolling-number num-tabular ${className}`.trim()}>
      <span className="visually-hidden">{value}</span>
      <span aria-hidden="true" className="rolling-number__slots">
        {chars.map((ch, idx) => {
          const isStatic = ch === ':' || ch === '.' || ch === '%' || ch === ' ';
          if (isStatic) {
            return (
              <span key={`s-${idx}`} className="rolling-number__sep">
                {ch}
              </span>
            );
          }
          return (
            <span key={`d-${idx}`} className="rolling-number__slot">
              <span
                key={`${idx}-${seqs[idx]}`}
                className={seqs[idx] > 0 ? 'rolling-number__char is-flipping' : 'rolling-number__char'}
              >
                {ch}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
};
