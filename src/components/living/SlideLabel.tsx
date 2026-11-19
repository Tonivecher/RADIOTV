import React from 'react';

interface SlideLabelProps {
  text: string;
  hoverText?: string;
  className?: string;
}

/**
 * Vertical double-slot hover label adapted from KokonutUI SlideTextButton.
 * Pure CSS transform on group hover/focus, zero JS overhead.
 */
export const SlideLabel: React.FC<SlideLabelProps> = ({ text, hoverText, className = '' }) => (
  <span className={`slide-label ${className}`.trim()}>
    <span className="slide-label__track">
      <span className="slide-label__primary">{text}</span>
      <span className="slide-label__secondary" aria-hidden="true">
        {hoverText ?? text}
      </span>
    </span>
  </span>
);
