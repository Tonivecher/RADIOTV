import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CHANNEL_COPY } from '../constants/radio';
import { ReactionKind } from '../types/radio';
import { formatTimecode } from '../utils/pow';
import { PauseSignalIcon, PlaySignalIcon } from './icons/RadioIcons';
import { LinkLadder } from './living/LinkLadder';
import { RollingNumber } from './living/RollingNumber';

interface FloatingMiniDockProps {
  visible: boolean;
  isPlaying: boolean;
  channelId: string;
  positionSec: number;
  onTogglePlay: () => void;
  onDropQuickMoment: (timestampSec: number) => Promise<void>;
  renderReactionIcon: (kind: ReactionKind, size?: number) => React.ReactNode;
}

export const FloatingMiniDock: React.FC<FloatingMiniDockProps> = ({
  visible,
  isPlaying,
  channelId,
  positionSec,
  onTogglePlay,
  onDropQuickMoment,
  renderReactionIcon,
}) => {
  const reducedMotion = Boolean(useReducedMotion());
  const [dockError, setDockError] = useState('');

  const handleMarkClick = () => {
    setDockError('');
    void onDropQuickMoment(Math.floor(positionSec)).catch((error) => {
      setDockError(
        error instanceof Error ? error.message : 'Не удалось оставить отметку.'
      );
    });
  };

  return (
    <>
      {dockError && (
        <p className="auth-error-box dock-action-error" role="alert">
          {dockError}
        </p>
      )}
      {/* Persistent Floating Glass Mini-Player Dock on Scroll */}
      <motion.aside
        className={`floating-mini-dock ${visible ? 'is-visible' : ''}`}
        aria-label="Плавающий мини-плеер эфира"
        inert={!visible}
        aria-hidden={!visible}
        initial={false}
        animate={
          reducedMotion
            ? { x: '-50%', y: 0, opacity: visible ? 1 : 0 }
            : {
              x: '-50%',
              opacity: visible ? 1 : 0,
              y: visible ? 0 : 18,
              scale: visible ? 1 : 0.97,
            }
        }
        transition={
          reducedMotion
            ? { duration: 0 }
            : { duration: 0.36, ease: [0.33, 1, 0.68, 1] }
        }
      >
        <div className="floating-mini-dock__left">
          <button
            type="button"
            className="mini-dock-play-btn button-circle button-circle--solo"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Пауза эфира' : 'Слушать прямой эфир'}
          >
            <span className="button-circle__icon-wrap" aria-hidden="true">
              <span className="button-circle__base-icon">
                {isPlaying ? <PauseSignalIcon size={16} /> : <PlaySignalIcon size={16} />}
              </span>
              <span className="button-circle__mask-icon">
                {isPlaying ? <PauseSignalIcon size={16} /> : <PlaySignalIcon size={16} />}
              </span>
            </span>
          </button>
          <div className="mini-dock-meta">
            <strong>ToniVecherRadio</strong>
            <span className="num-tabular">
              {CHANNEL_COPY[channelId]?.name || 'Эфир'} ·{' '}
              <RollingNumber value={formatTimecode(positionSec)} />
            </span>
          </div>
        </div>

        <div className="floating-mini-dock__right">
          <button
            type="button"
            className="glass-pill-btn living-hover-btn"
            onClick={handleMarkClick}
          >
            {renderReactionIcon('fire', 14)}
            <LinkLadder text="Отметить" />
          </button>
          <button
            type="button"
            className="glass-pill-btn living-hover-btn"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <LinkLadder text="Наверх ↑" />
          </button>
        </div>
      </motion.aside>
    </>
  );
};
