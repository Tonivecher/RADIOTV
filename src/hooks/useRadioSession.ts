import { useCallback, useRef, useState } from 'react';
import { UserSession } from '../types/radio';
import { solvePowChallenge } from '../utils/pow';
import { safeStorage } from '../utils/storage';

const SESSION_STORAGE_KEY = 'radiotv_session';

function loadStoredSession(): UserSession | null {
  try {
    const raw = safeStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UserSession) : null;
  } catch {
    return null;
  }
}

export function useRadioSession() {
  const [session, setSession] = useState<UserSession | null>(loadStoredSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sessionInFlight = useRef<Promise<UserSession> | null>(null);
  const actionsInFlight = useRef(new Set<string>());
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    safeStorage.removeItem(SESSION_STORAGE_KEY);
    setAuthModalOpen(true);
  }, []);

  const handleAuthenticated = useCallback((newSession: UserSession) => {
    sessionRef.current = newSession;
    setSession(newSession);
    safeStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
  }, []);

  const ensureSession = useCallback(async (): Promise<UserSession> => {
    if (sessionInFlight.current) {
      return sessionInFlight.current;
    }

    const job = (async () => {
      const saved = sessionRef.current;
      if (saved?.token) {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${saved.token}` },
        });
        if (res.status === 401) {
          clearSession();
          throw new Error('Сессия истекла. Войдите снова и повторите действие.');
        }
        if (!res.ok) {
          throw new Error('Не удалось проверить сессию. Повторите позже.');
        }
        return saved;
      }

      const challengeRes = await fetch('/api/auth/challenge');
      if (!challengeRes.ok) {
        throw new Error('Не удалось начать гостевой вход.');
      }
      const challenge = await challengeRes.json();
      const solved = await solvePowChallenge(challenge.prefix, challenge.difficulty || 3);
      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          nonce: solved.nonce,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.session?.token) {
        throw new Error(data.error || 'Не удалось войти.');
      }

      const user: UserSession = data.session;
      handleAuthenticated(user);
      return user;
    })();

    sessionInFlight.current = job;
    try {
      return await job;
    } finally {
      sessionInFlight.current = null;
    }
  }, [clearSession, handleAuthenticated]);

  const postAction = useCallback(
    async <T = Record<string, unknown>>(key: string, url: string, body: object): Promise<T> => {
      if (actionsInFlight.current.has(key)) {
        throw new Error('Действие уже отправляется.');
      }
      actionsInFlight.current.add(key);
      try {
        const activeUser = await ensureSession();
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${activeUser.token}`,
          },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          clearSession();
        }
        if (!res.ok || data.ok !== true) {
          throw new Error(data.error || 'Действие не сохранено. Повторите позже.');
        }
        return data as T;
      } catch (error) {
        if (error instanceof TypeError) {
          throw new Error('Нет связи с сервером. Проверьте соединение и повторите.');
        }
        throw error;
      } finally {
        actionsInFlight.current.delete(key);
      }
    },
    [clearSession, ensureSession]
  );

  return {
    session,
    sessionRef,
    authModalOpen,
    setAuthModalOpen,
    clearSession,
    ensureSession,
    postAction,
    handleAuthenticated,
  };
}
