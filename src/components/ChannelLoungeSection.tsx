import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CHANNEL_COPY } from '../constants/radio';
import { RadioChannelInfo } from '../types/radio';
import { RadioWavePaths } from './RadioWavePaths';
import { FloatPanel } from './SpatialMotion';
import { InteractiveNote } from './living/InteractiveNote';
import { SlideLabel } from './living/SlideLabel';

interface ChannelLoungeSectionProps {
  channels: RadioChannelInfo[];
  channelId: string;
  onSelectChannel: (channelId: string) => void;
  children: React.ReactNode;
}

export const ChannelLoungeSection: React.FC<ChannelLoungeSectionProps> = ({
  channels,
  channelId,
  onSelectChannel,
  children,
}) => {
  const reducedMotion = Boolean(useReducedMotion());

  const handleRowPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || e.pointerType === 'touch') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100;
    const my = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100;
    e.currentTarget.style.setProperty('--mx', `${mx.toFixed(1)}%`);
    e.currentTarget.style.setProperty('--my', `${my.toFixed(1)}%`);
  };

  return (
    <section
      id="lounge-stage"
      className="scroll-reveal-section is-inview lounge-stage-section"
      aria-label="Выбор канала"
    >
      <RadioWavePaths channelId={channelId} />
      <div className="lounge-split-grid">
        {/* Left Column: Open Spatial Frequency Telemetry & Morphic Channel Switcher */}
        <FloatPanel className="lounge-telemetry-col" depth={1.4}>
          <div className="lounge-telemetry-header">
            <span className="section-eyebrow">Каналы</span>
            <h2 className="section-heading">Три волны</h2>
            <p className="lounge-telemetry-sub">
              Прыгай между каналами, эквалайзер не слетит.
            </p>
          </div>

          <div
            className="channel-architecture-list"
            role="radiogroup"
            aria-label="Каналы эфира"
          >
            {channels.map((ch, idx) => {
              const isCurrent = channelId === ch.id;
              return (
                <div
                  key={ch.id}
                  role="radio"
                  tabIndex={0}
                  aria-checked={isCurrent}
                  className={`channel-lens-row living-hover-btn ${isCurrent ? 'is-active' : ''}`}
                  onPointerMove={handleRowPointerMove}
                  onClick={() => onSelectChannel(ch.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectChannel(ch.id);
                    }
                  }}
                >
                  {isCurrent && (
                    <motion.span
                      layoutId="lounge-channel-indicator"
                      className="channel-lens-row__glow"
                      transition={
                        reducedMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 420, damping: 34 }
                      }
                      aria-hidden="true"
                    />
                  )}
                  <div className="channel-lens-row__left">
                    <span className="channel-lens-row__freq num-tabular">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <strong className="channel-lens-row__name">
                      {CHANNEL_COPY[ch.id]?.name || ch.name}
                    </strong>
                    <span className="channel-lens-row__desc">
                      {CHANNEL_COPY[ch.id]?.description || ch.description}
                    </span>
                  </div>
                  <span className="channel-lens-row__action">
                    <SlideLabel text={isCurrent ? 'Выбран' : 'Слушать ↗'} />
                  </span>
                </div>
              );
            })}
          </div>

          <InteractiveNote
            title="Без названий треков"
            body="Теги вырезаны. Зашёл момент, ставь метку на таймлайне."
            secretHint="Вагон 4:20 · только звук, никаких ID3"
          />
        </FloatPanel>

        {/* Right Column: Airy Glass Live Ether Chat */}
        {children}
      </div>
    </section>
  );
};
