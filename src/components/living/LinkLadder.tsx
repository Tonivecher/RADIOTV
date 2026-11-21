import React from 'react';

interface LinkLadderProps {
  text: string;
  active?: boolean;
  className?: string;
}

/**
 * Pure CSS rolling letter cascade inspired by Unikorns LinkLadder.
 * Keeps full accessible text in a visually-hidden span so screen readers
 * read the whole phrase cleanly instead of spelling it letter by letter.
 */
export const LinkLadder: React.FC<LinkLadderProps> = ({
  text,
  active = false,
  className = '',
}) => {
  const letters = Array.from(text);

  return (
    <span className={`link-ladder ${active ? 'link-ladder_active' : ''} ${className}`.trim()}>
      <span className="visually-hidden">{text}</span>
      <span className="link-ladder__word" aria-hidden="true">
        {letters.map((char, idx) => (
          <span
            key={`${idx}-${char}`}
            className="link-ladder__letter"
            style={
              idx >= 20
                ? { transitionDelay: `${(idx + 1) * 0.04}s` }
                : undefined
            }
          >
            {char === ' ' ? '\u00A0' : char}
          </span>
        ))}
      </span>
    </span>
  );
};
