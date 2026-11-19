import React, { useEffect, useRef, useState } from 'react';
import { FloatPanel } from './SpatialMotion';
import { UserSession } from '../types/radio';
import { solvePowChallenge } from '../utils/pow';

interface AuthShieldModalProps {
  isOpen: boolean;
  currentSession: UserSession | null;
  onClose: () => void;
  onAuthenticated: (session: UserSession) => void;
}

const AVATAR_SWATCHES = [
  '#38BDF8',
  '#10B981',
  '#F59E0B',
  '#D97757',
  '#A3E635',
  '#C084FC',
  '#F43F5E',
];

export const AuthShieldModal: React.FC<AuthShieldModalProps> = ({
  isOpen,
  currentSession,
  onClose,
  onAuthenticated,
}) => {
  const [callsign, setCallsign] = useState<string>(currentSession?.callsign || '');
  const [pin, setPin] = useState<string>('');
  const [avatarColor, setAvatarColor] = useState<string>(
    currentSession?.avatarColor || AVATAR_SWATCHES[0]
  );
  const [honeypot, setHoneypot] = useState<string>('');
  const [statusText, setStatusText] = useState<string>('');
  const [errorText, setErrorText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const focusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      focusTimerRef.current = window.setTimeout(() => {
        focusTimerRef.current = null;
        previous?.focus({ preventScroll: true });
      }, 0);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const performLogin = async (targetCallsign: string, targetPin: string, guest = false) => {
    setLoading(true);
    setErrorText('');
    setStatusText('Подключаемся…');
    try {
      const chRes = await fetch('/api/auth/challenge');
      const chData = await chRes.json();
      if (!chRes.ok) throw new Error('Challenge unavailable');

      setStatusText('Проверяем вход…');
      const pow = await solvePowChallenge(chData.prefix, chData.difficulty || 3);

      setStatusText('Завершаем вход…');
      const loginRes = await fetch(guest ? '/api/auth/guest' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callsign: targetCallsign,
          pin: targetPin,
          avatarColor,
          challengeId: chData.challengeId,
          nonce: pow.nonce,
          websiteHoneypot: honeypot,
        }),
      });

      const loginData = await loginRes.json();
      if (!loginRes.ok || loginData.error) {
        setErrorText(loginData.error || 'Не удалось пройти авторизацию');
        setStatusText('');
        return;
      }

      onAuthenticated(loginData.session);
      onClose();
    } catch {
      setStatusText('');
      setErrorText('Не удалось войти. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = callsign.trim();
    if (cleaned.length < 2) {
      setErrorText('Введите имя от 2 символов');
      return;
    }
    await performLogin(cleaned, pin.trim());
  };

  const handleQuickSelector = async () => {
    await performLogin('', '', true);
  };

  return (
    <div
      ref={dialogRef}
      className="auth-modal-backdrop"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
          return;
        }
        if (e.key !== 'Tab') {
          return;
        }
        const controls = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not([aria-hidden="true"]):not(:disabled)'
          )
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Вход в ToniVecherRadio"
    >
      <FloatPanel className="auth-modal" depth={0.6}>
        <div className="auth-modal__top">
          <div>
            <span className="auth-modal__code">Вагон 4:20</span>
            <h2 className="auth-modal__title">Кто в эфире?</h2>
          </div>
          <button type="button" className="auth-modal__close" aria-label="Закрыть окно входа" onClick={onClose}>
            ×
          </button>
        </div>

        <p className="auth-modal__desc">
          Придумай позывной и PIN (6–16 цифр), чтобы закрепить его за собой. Или просто заходи гостем.
        </p>

        <form className="auth-modal__form" onSubmit={handleSubmit}>
          {/* Honeypot field hidden from humans */}
          <input
            type="text"
            name="website_url_confirm"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            className="auth-honeypot"
            aria-hidden="true"
          />

          <label className="auth-field">
            <span className="auth-field__label">Позывной</span>
            <input
              type="text"
              className="auth-field__input"
              placeholder="Позывной"
              maxLength={20}
              value={callsign}
              onChange={(e) => setCallsign(e.target.value)}
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-field__label">PIN-код · 6–16 цифр</span>
            <input
              type="password"
              className="auth-field__input"
              placeholder="PIN-код для повторного входа"
              required
              minLength={6}
              maxLength={16}
              pattern="[0-9]{6,16}"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </label>

          <div className="auth-field">
            <span className="auth-field__label">Цвет отметок</span>
            <div className="auth-swatches">
              {AVATAR_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`auth-swatch ${avatarColor === hex ? 'is-selected' : ''}`}
                  style={{ backgroundColor: hex }}
                  onClick={() => setAvatarColor(hex)}
                  aria-label={`Цвет ${hex}`}
                />
              ))}
            </div>
          </div>

          {statusText && <div className="auth-status-box">{statusText}</div>}
          {errorText && <div className="auth-error-box">{errorText}</div>}

          <div className="auth-modal__actions">
            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? 'Входим…' : 'Войти'}
            </button>
            <button
              type="button"
              className="auth-guest-btn"
              disabled={loading}
              onClick={handleQuickSelector}
            >
              Продолжить гостем
            </button>
          </div>
        </form>
      </FloatPanel>
    </div>
  );
};
