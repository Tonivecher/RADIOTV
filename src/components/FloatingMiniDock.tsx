import React, { useState } from 'react';
import { CHANNEL_COPY } from '../constants/radio';
import { ReactionKind } from '../types/radio';
import { formatTimecode } from '../utils/pow';
import { PauseSignalIcon, PlaySignalIcon } from './icons/RadioIcons';
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
      <aside
        className={`floating-mini-dock ${visible ? 'is-visible' : ''}`}
        aria-label="Плавающий мини-плеер эфира"
        inert={!visible}
        aria-hidden={!visible}
      >
        <div className="floating-mini-dock__left">
          <button
            type="button"
            className="mini-dock-play-btn"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Пауза эфира' : 'Слушать прямой эфир'}
          >
            {isPlaying ? <PauseSignalIcon size={16} /> : <PlaySignalIcon size={16} />}
          </button>
          <div className="mini-dock-meta">
            <strong>ToniVecherRadio</strong>
            <span>
              {CHANNEL_COPY[channelId]?.name || 'Эфир'} ·{' '}
              <RollingNumber value={formatTimecode(positionSec)} />
            </span>
          </div>
        </div>

        <div className="floating-mini-dock__right">
          <button
            type="button"
            className="glass-pill-btn"
            onClick={handleMarkClick}
          >
            {renderReactionIcon('fire', 14)}
            <span>Отметить</span>
          </button>
          <button
            type="button"
            className="glass-pill-btn"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <span>Наверх ↑</span>
          </button>
        </div>
      </aside>
    </>
  );
};
