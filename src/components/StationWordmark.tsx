import { type CSSProperties } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useSpatialMotion } from './SpatialMotion';

const NAME = 'ToniVecherRadio';

/** A brief split-flap ripple, once every ten seconds. */
export function StationWordmark() {
  const reduced = useReducedMotion();
  const { visible } = useSpatialMotion();

  return (
    <span
      className="island-brand__title station-wordmark"
      data-paused={!visible || reduced ? 'true' : undefined}
    >
      <span className="visually-hidden">{NAME}</span>
      {Array.from(NAME, (letter, index) => (
        <span
          key={index}
          className="station-wordmark__letter"
          aria-hidden="true"
          style={{ '--letter-delay': `${index * 32}ms` } as CSSProperties}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}
