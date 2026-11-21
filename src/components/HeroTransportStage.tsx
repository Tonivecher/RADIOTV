import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { SyncSnapshot } from '../audio/liveSync';
import { CHANNEL_GENRE_TAGS } from '../constants/radio';
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
import { AsciiDancers } from './AsciiDancers';
import { AttractPlayButton } from './living/AttractPlayButton';
import { DecodeText } from './living/DecodeText';
import { GlitchText } from './living/GlitchText';
import { RollingNumber } from './living/RollingNumber';
import { SlideLabel } from './living/SlideLabel';

interface HeroTransportStageProps {
  channelId: string;
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
  channelId,
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
  const reducedMotion = Boolean(useReducedMotion());
  const genreTags = CHANNEL_GENRE_TAGS[channelId] || CHANNEL_GENRE_TAGS['ch-main'];
  const [rotator, setRotator] = useState(() => ({ channelId, index: 0 }));
  const activeTagIndex = rotator.channelId === channelId ? rotator.index % genreTags.length : 0;
  const activeGenreTag = genreTags[activeTagIndex] || genreTags[0];

  useEffect(() => {
    setRotator({ channelId, index: 0 });
    if (reducedMotion || genreTags.length <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setRotator((prev) => ({
        channelId,
        index: prev.channelId === channelId ? (prev.index + 1) % genreTags.length : 0,
      }));
    }, 3600);
    return () => window.clearInterval(timer);
  }, [channelId, reducedMotion, genreTags.length]);

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
    <section
      id="ether-stage"
      className="scroll-reveal-section is-inview hero-stage-section"
      aria-label="Прямой эфир и интерактивная аудиоволна"
    >
      <div className="hero-lamp-spotlight" aria-hidden="true">
        <div className="hero-lamp-spotlight__cones">
          <motion.div
            className="hero-lamp-spotlight__wing hero-lamp-spotlight__wing--left"
            initial={reducedMotion ? false : { opacity: 0.4, scaleX: 0.72 }}
            animate={{ opacity: 0.72, scaleX: 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.85, ease: 'easeOut' }}
            style={{ transformOrigin: 'right top' }}
          />
          <motion.div
            className="hero-lamp-spotlight__wing hero-lamp-spotlight__wing--right"
            initial={reducedMotion ? false : { opacity: 0.4, scaleX: 0.72 }}
            animate={{ opacity: 0.72, scaleX: 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.85, ease: 'easeOut' }}
            style={{ transformOrigin: 'left top' }}
          />
          <div className="hero-lamp-spotlight__glow" />
        </div>
        <motion.div
          className="hero-lamp-spotlight__bar"
          initial={reducedMotion ? false : { opacity: 0.5, scaleX: 0.55 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.75, ease: 'easeOut' }}
        />
      </div>

      <div className="hero-editorial-grid">
        <FloatPanel className="hero-title-region" depth={0.9}>
          <div className="hero-editorial-grid__left">
            <div className="hero-eyebrow-line">
              <span className="pulse-beacon is-live">
                <span className="pulse-beacon__core" />
                <span className="pulse-beacon__ring" />
              </span>
              <span>{isStateLoaded ? 'Прямой эфир' : 'Подключаемся к эфиру'}</span>
              <span className="hero-eyebrow-sep">/</span>
              <span className="hero-eyebrow-tag-slot">
                <DecodeText text={activeGenreTag} className="hero-eyebrow-tag" />
              </span>
            </div>
            <div className="hero-title-stage">
              <AsciiDancers channelId={channelId} />
              <GlitchText
                as="h1"
                text="ToniVecherRadio"
                trigger="both"
                intensity="subtle"
                interactiveShadow
                className="hero-display-title"
              />
            </div>
            <p className="hero-lead-copy">
              Три канала без треклистов. Жми плэй, кидай отметки в сет.
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
        </FloatPanel>

        {/* Right: Magnetic Attract Transport Cluster & Custom Glass Volume Ribbon */}
        <FloatPanel className="hero-control-region" depth={0.7}>
          <div className="hero-transport-cluster">
            <div className={`sync-chip is-${syncView.tone}`} data-sync-state={syncSnapshot.state}>
              <span className="sync-chip__led" aria-hidden="true" />
              <span className="sync-chip__text num-tabular" aria-hidden="true">
                {syncView.label}
              </span>
              <span className="visually-hidden" role="status" aria-live="polite">
                {syncView.announce}
              </span>
            </div>

            <AttractPlayButton
              isPlaying={isPlaying}
              onClick={onTogglePlay}
              className={`magnetic-cta magnetic-cta--hero button-circle button-circle--hero ${isPlaying ? 'is-playing' : ''}`}
              ariaLabel={isPlaying ? 'Пауза эфира' : 'Слушать радио'}
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
                  <span className="magnetic-cta__pod button-circle__icon-wrap">
                    <span className="button-circle__base-icon">
                      {isPlaying ? <PauseSignalIcon size={16} /> : <PlaySignalIcon size={16} />}
                    </span>
                    <span className="button-circle__mask-icon">
                      {isPlaying ? <PauseSignalIcon size={16} /> : <PlaySignalIcon size={16} />}
                    </span>
                  </span>
                </motion.span>
              </AnimatePresence>
            </AttractPlayButton>

            <div className="hero-secondary-controls">
              <button
                type="button"
                className="glass-pill-btn living-hover-btn"
                onClick={onResyncLive}
                title="Вернуться к текущему моменту эфира"
              >
                <span className="living-icon-wiggle">
                  <ResyncLiveIcon size={15} />
                </span>
                <SlideLabel text="К эфиру" />
              </button>

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
                <span className="glass-volume-val num-tabular">
                  <RollingNumber value={`${masterGain}%`} />
                </span>
              </div>
            </div>
          </div>
        </FloatPanel>
      </div>

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
    </section>
  );
};
