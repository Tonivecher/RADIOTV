import { FloatPanel } from './SpatialMotion';
import React, { useRef, useState } from 'react';
import {
  ChatMessageItem,
  REACTION_CATALOG,
  ReactionKind,
  UserSession,
} from '../types/radio';
import { formatTimecode } from '../utils/pow';
import { RollingNumber } from './living/RollingNumber';

interface LiveEtherChatProps {
  messages: ChatMessageItem[];
  listenersCount: number;
  session: UserSession | null;
  activeSetCode: string;
  currentPositionSec: number;
  onSendMessage: (text: string) => Promise<void>;
  onReactToMessage: (messageId: number, kind: ReactionKind) => Promise<void>;
  onOpenAuthModal: () => void;
  renderReactionIcon: (kind: ReactionKind, size?: number) => React.ReactNode;
}

export const LiveEtherChat: React.FC<LiveEtherChatProps> = ({
  messages,
  listenersCount,
  session,
  activeSetCode,
  currentPositionSec,
  onSendMessage,
  onReactToMessage,
  onOpenAuthModal,
  renderReactionIcon,
}) => {
  const [errorText, setErrorText] = useState('');
  const [draft, setDraft] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [openPickerForId, setOpenPickerForId] = useState<number | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const visibleMessages = messages.slice(-5);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setErrorText('');
    try {
      await onSendMessage(text);
      setDraft((current) => current.trim() === text ? '' : current);
      if (feedRef.current) {
        feedRef.current.scrollTop = feedRef.current.scrollHeight;
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось отправить сообщение.');
    } finally {
      setSending(false);
    }
  };

  const react = async (id: number, kind: ReactionKind) => {
    setErrorText('');
    try {
      await onReactToMessage(id, kind);
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : 'Не удалось сохранить отклик.'
      );
    }
  };

  return (
    <FloatPanel className="glass-double-shell chat-shell" aria-label="Живой чат радиоэфира">
      <div className="glass-double-core chat-core">
        {/* Top Header */}
        <div className="chat-header">
          <div className="chat-header__left">
            <span className="section-eyebrow">Разговоры под музыку</span>
            <h2 className="section-heading">Чат эфира</h2>
          </div>

          <div className="chat-header__right">
            <span className="chat-online-pill">
              <span className="pulse-beacon is-live">
                <span className="pulse-beacon__core" />
                <span className="pulse-beacon__ring" />
              </span>
              <span>Подключения: {listenersCount}</span>
            </span>

            {session ? (
              <button
                type="button"
                className="glass-pill-btn"
                onClick={onOpenAuthModal}
                title="Изменить профиль"
              >
                <span>@{session.callsign}</span>
              </button>
            ) : (
              <button
                type="button"
                className="glass-pill-btn"
                onClick={onOpenAuthModal}
              >
                <span>Войти</span>
              </button>
            )}
          </div>
        </div>

        {/* Open Airy Messages Stream (hairline separators, no nested boxes) */}
        <div ref={feedRef} className="chat-stream">
          {visibleMessages.length === 0 && (
            <p className="chat-empty">
              Пока тихо. Можно просто слушать или начать разговор.
            </p>
          )}
          {visibleMessages.map((msg) => {
            const reactionEntries = Object.entries(msg.reactions || {}).filter(
              ([, count]) => (count || 0) > 0
            ) as Array<[ReactionKind, number]>;

            return (
              <article key={msg.id} className="chat-entry">
                <div className="chat-entry__meta">
                  <strong className="chat-entry__author">@{msg.callsign}</strong>
                  <span className="chat-entry__stamp">
                    {msg.setCode.replace('TRANSMISSION // ', '')} ·{' '}
                    {formatTimecode(msg.setTimestampSec)}
                  </span>
                </div>

                <p className="chat-entry__body">{msg.text}</p>

                <div className="chat-entry__reactions">
                  {reactionEntries.map(([kind, count]) => (
                    <button
                      key={kind}
                      type="button"
                      className="chat-react-chip"
                      onClick={() => void react(msg.id, kind)}
                    >
                      {renderReactionIcon(kind, 13)}
                      <span>{count}</span>
                    </button>
                  ))}

                  <div className="chat-picker-anchor">
                    <button
                      type="button"
                      className="chat-react-trigger"
                      onClick={() =>
                        setOpenPickerForId((prev) => (prev === msg.id ? null : msg.id))
                      }
                    >
                      + Реакция
                    </button>

                    {openPickerForId === msg.id && (
                      <div className="chat-react-popover" role="menu">
                        {REACTION_CATALOG.map((r) => (
                          <button
                            key={r.kind}
                            type="button"
                            className="chat-react-popover__item"
                            title={r.label}
                            onClick={() => {
                              void react(msg.id, r.kind);
                              setOpenPickerForId(null);
                            }}
                          >
                            {renderReactionIcon(r.kind, 15)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {errorText && (
          <p role="alert" className="auth-error-box">
            {errorText}
          </p>
        )}
        {/* Message Composer */}
        <form className="chat-composer" onSubmit={handleSubmit}>
          <div className="chat-composer__status">
            <span>Сет: {activeSetCode.replace('TRANSMISSION // ', '')}</span>
            <span>
              Сейчас: <RollingNumber value={formatTimecode(currentPositionSec)} />
            </span>
          </div>
          <div className="chat-composer__row">
            <input
              type="text"
              className="chat-composer__input"
              aria-label="Сообщение в чат"
              placeholder="Написать в чат…"
              maxLength={280}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              className="magnetic-cta magnetic-cta--compact"
              disabled={sending}
            >
              <span>{sending ? 'Отправляем…' : 'Отправить'}</span>
              <span className="magnetic-cta__pod" aria-hidden="true">↗</span>
            </button>
          </div>
        </form>
      </div>
    </FloatPanel>
  );
};
