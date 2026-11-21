import React from 'react';
import { LinkLadder } from './LinkLadder';

interface SlideLabelProps {
  text: string;
  hoverText?: string;
  className?: string;
}

/**
 * Pure CSS hover label upgraded with Unikorns LinkLadder cascade when
 * primary and hover labels match, while keeping double-slot slide support
 * if distinct hoverText is explicitly provided.
 */
export const SlideLabel: React.FC<SlideLabelProps> = ({ text, hoverText, className = '' }) => {
  if (!hoverText || hoverText === text) {
    return <LinkLadder text={text} className={className} />;
  }

  return (
    <span className={`slide-label ${className}`.trim()}>
      <span className="slide-label__track">
        <span className="slide-label__primary">{text}</span>
        <span className="slide-label__secondary" aria-hidden="true">
          {hoverText}
        </span>
      </span>
    </span>
  );
};
