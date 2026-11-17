import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { SyncSnapshot } from '../audio/liveSync';
import { ReactionKind, WaveformMoment } from '../types/radio';
import { SyncView } from '../utils/radioState';
import {
  PauseSignalIcon,
  PlaySignalIcon,
  ResyncLiveIcon,
  VolumeDspIcon,
} from './icons/RadioIcons';
import { FloatPanel } from './SpatialMotion';
import { WaveformTimeline } from './WaveformTimeline';

interface HeroTransportStageProps {
  isStateLoaded: boolean;
  stateError: string;
  audioError: string;
  isPlaying: boolean;
  syncSnapshot: SyncSnapshot;
  syncView: SyncView;
  masterGain: number;
  peaks: number[];
  heatmap: number[];
  durationSec: number;
  positionSec: number;
  moments: WaveformMoment[];
  onRetryState: () => void;
  onRetryAudio: () => void;
  onTogglePlay: () => void;
  onResyncLive: () => void;
  onMasterGainChange: (masterGain: number) => void;
  onDropMoment: (timestampSec: number, reactionType: ReactionKind, comment: string) => Promise<void>;
  onLikeMoment: (momentId: number) => Promise<void>;
  renderReactionIcon: (kind: ReactionKind, size?: number) => React.ReactNode;
}

export const HeroTransportStage: React.FC<HeroTransportStageProps> = ({
  isStateLoaded,
  stateError,
  audioError,
  isPlaying,
  syncSnapshot,
  syncView,
  masterGain,
  peaks,
  heatmap,
  durationSec,
  positionSec,
  moments,
  onRetryState,
  onRetryAudio,
  onTogglePlay,
  onResyncLive,
  onMasterGainChange,
  onDropMoment,
  onLikeMoment,
  renderReactionIcon,
}) => {
  const reducedMotion = useReducedMotion();

  const updateVolumeFromClientX = (el: HTMLDivElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onMasterGainChange(Math.round(ratio * 100));
  };

  const releaseVolumeCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: reducedMotion ? 0 : 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.05 }}
      transition={{ duration: 0.7 }}
      id="ether-stage"
      className="scroll-reveal-section is-inview hero-stage-section"
      aria-label="Прямой эфир и интерактивная аудиоволна"
    >
      <motion.div
        className="hero-editorial-grid"
        initial={{ opacity: 0, y: reducedMotion ? 0 : 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.25 }}
      >
        <div className="hero-editorial-grid__left">
          <div className="hero-eyebrow-line">
            <span className="pulse-beacon is-live">
              <span className="pulse-beacon__core" />
              <span className="pulse-beacon__ring" />
            </span>
            <span>{isStateLoaded ? 'Прямой эфир' : 'Подключаемся к эфиру'}</span>
            <span className="hero-eyebrow-sep">/</span>
            <span>deep-tech · tech · deep · downtempo</span>
          </div>
          <h1
            className="hero-display-title"
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
              fontWeight: 400,
              letterSpacing: '-0.055em',
            }}
          >
            ToniVecherRadio
          </h1>
          <p className="hero-lead-copy" style={{ fontFamily: "'Inter', sans-serif" }}>
            Выбирайте канал и слушайте вместе.
            Понравился момент — отметьте его на волне.
          </p>
          {stateError && (
            <p className="auth-error-box" role="alert">
              {stateError}{' '}
              <button type="button" onClick={onRetryState}>
                Повторить
              </button>
            </p>
          )}
          {audioError && (
            <p className="auth-error-box" role="alert">
              {audioError}{' '}
              <button type="button" onClick={onRetryAudio}>
                Повторить
              </button>
            </p>
          )}
        </div>

        {/* Right: Magnetic Transport Cluster & Custom Glass Volume Ribbon */}
        <FloatPanel className="hero-control-region" depth={0.7}>
          <div className="hero-transport-cluster">
            <div className={`sync-chip is-${syncView.tone}`} data-sync-state={syncSnapshot.state}>
              <span className="sync-chip__led" aria-hidden="true" />
              <span className="sync-chip__text" aria-hidden="true">
                {syncView.label}
              </span>
              {/* Screen readers get the state only, not every 0.1 s drift tick */}
              <span className="visually-hidden" role="status" aria-live="polite">
                {syncView.announce}
              </span>
            </div>

            <motion.button
              whileHover={{ scale: reducedMotion ? 1 : 1.03 }}
              whileTap={{ scale: reducedMotion ? 1 : 0.97 }}
              type="button"
              className={`magnetic-cta magnetic-cta--hero ${isPlaying ? 'is-playing' : ''}`}
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Пауза эфира' : 'Слушать радио'}
            >
              <span className="magnetic-cta__halo" aria-hidden="true" />
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={isPlaying ? 'pause' : 'play'}
                  className="transport-button-content"
                  aria-hidden="true"
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reducedMotion ? 0 : -5 }}
                  transition={{ duration: reducedMotion ? 0 : 0.14 }}
                >
                  <span className="magnetic-cta__label">
                    {isPlaying ? 'Пауза' : 'Слушать радио'}
                  </span>
                  <span className="magnetic-cta__pod">
                    {isPlaying ? <PauseSignalIcon size={18} /> : <PlaySignalIcon size={18} />}
                  </span>
                </motion.span>
              </AnimatePresence>
            </motion.button>

            <div className="hero-secondary-controls">
              <button
                type="button"
                className="glass-pill-btn"
                onClick={onResyncLive}
                title="Вернуться к текущему моменту эфира"
              >
                <ResyncLiveIcon size={15} />
                <span>К эфиру</span>
              </button>

              {/* Custom Pointer-Captured Glass Volume Ribbon (Zero browser range inputs!) */}
              <div className="glass-volume-control">
                <VolumeDspIcon size={16} />
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Громкость эфира"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={masterGain}
                  className="glass-volume-ribbon"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    updateVolumeFromClientX(e.currentTarget, e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
                      return;
                    }
                    updateVolumeFromClientX(e.currentTarget, e.clientX);
                  }}
                  onPointerUp={releaseVolumeCapture}
                  onPointerCancel={releaseVolumeCapture}
                  onLostPointerCapture={releaseVolumeCapture}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') {
                      e.preventDefault();
                      onMasterGainChange(Math.min(100, masterGain + 5));
                    } else if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      onMasterGainChange(Math.max(0, masterGain - 5));
                    }
                  }}
                >
                  <span
                    className="glass-volume-ribbon__fill"
                    style={{ width: `${masterGain}%` }}
                  />
                  <span
                    className="glass-volume-ribbon__thumb"
                    style={{ left: `calc(${masterGain}% - 6px)` }}
                  />
                </div>
                <span className="glass-volume-val">{masterGain}%</span>
              </div>
            </div>
          </div>
        </FloatPanel>
      </motion.div>

      {/* Double-Bezel Liquid Glass SoundCloud-Pro Waveform Stage */}
      <WaveformTimeline
        peaks={peaks}
        heatmap={heatmap}
        durationSec={durationSec}
        positionSec={positionSec}
        moments={moments}
        isPlaying={isPlaying}
        onDropMoment={onDropMoment}
        onLikeMoment={onLikeMoment}
        renderReactionIcon={renderReactionIcon}
      />
    </motion.section>
  );
};
