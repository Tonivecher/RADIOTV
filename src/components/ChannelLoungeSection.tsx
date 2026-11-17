import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CHANNEL_COPY } from '../constants/radio';
import { RadioChannelInfo } from '../types/radio';
import { BlindMaskIcon } from './icons/RadioIcons';
import { FloatPanel } from './SpatialMotion';

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
  const reducedMotion = useReducedMotion();

  return (
    <motion.section
      initial={{ opacity: 0, y: reducedMotion ? 0 : 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.05 }}
      transition={{ duration: 0.7 }}
      id="lounge-stage"
      className="scroll-reveal-section lounge-stage-section"
      aria-label="Выбор канала"
    >
      <div className="lounge-split-grid">
        {/* Left Column: Open Spatial Frequency Telemetry & Design Switcher Cards */}
        <FloatPanel className="lounge-telemetry-col" depth={1.4}>
          <div className="lounge-telemetry-header">
            <span className="section-eyebrow">Выберите настроение</span>
            <h2 className="section-heading">На вашей волне</h2>
            <p className="lounge-telemetry-sub">
              Переключайте канал, когда хочется другого ритма.
              Настройки звука сохранятся.
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
                  className={`channel-lens-row ${isCurrent ? 'is-active' : ''}`}
                  onClick={() => onSelectChannel(ch.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectChannel(ch.id);
                    }
                  }}
                >
                  <div className="channel-lens-row__left">
                    <span className="channel-lens-row__freq">
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
                    {isCurrent ? 'Выбран' : 'Слушать ↗'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="security-glass-note">
            <BlindMaskIcon size={20} />
            <div>
              <strong>Слушайте без треклиста</strong>
              <p>Названия треков скрыты. Если понравился момент, оставьте отметку на волне.</p>
            </div>
          </div>
        </FloatPanel>

        {/* Right Column: Airy Glass Live Ether Chat */}
        {children}
      </div>
    </motion.section>
  );
};
