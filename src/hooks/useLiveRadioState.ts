import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveClock } from '../audio/liveSync';
import { EMPTY_STATE } from '../constants/radio';
import { ChatMessageItem, RadioStatePayload, WaveformMoment } from '../types/radio';
import {
  applyMessageToRadioState,
  applyMomentToRadioState,
  mergeRadioStateSnapshot,
  parseRadioStateResponse,
} from '../utils/radioState';

interface UseLiveRadioStateParams {
  onBroadcastSynced: (setKey: string) => void;
}

export function useLiveRadioState({ onBroadcastSynced }: UseLiveRadioStateParams) {
  const [channelId, setChannelId] = useState<string>('ch-main');
  const [radioState, setRadioState] = useState<RadioStatePayload>(EMPTY_STATE);
  const [stateError, setStateError] = useState('');
  const [isStateLoaded, setIsStateLoaded] = useState<boolean>(false);
  const [livePositionSec, setLivePositionSec] = useState<number>(0);

  const [liveClock] = useState(() => new LiveClock());

  const channelIdRef = useRef<string>('ch-main');
  const anchorChannelRef = useRef<string>('');
  const currentSetIdRef = useRef<string>('');
  const stateRequestRef = useRef(0);
  const stateAbortRef = useRef<AbortController | null>(null);
  const fetchInFlightRef = useRef<boolean>(false);
  const stateLoadRef = useRef<{ channel: string; promise: Promise<void> } | null>(null);
  const loadedStateChannelRef = useRef<string>('');
  const lastRolloverFetchRef = useRef<number>(0);
  const durationRef = useRef<number>(EMPTY_STATE.broadcast.durationSec);

  const onBroadcastSyncedRef = useRef(onBroadcastSynced);
  onBroadcastSyncedRef.current = onBroadcastSynced;

  const applyMoment = useCallback((data: { moment: WaveformMoment; heatmap?: number[] }) => {
    setRadioState((prev) => applyMomentToRadioState(prev, data));
  }, []);

  const applyMessage = useCallback((message: ChatMessageItem) => {
    setRadioState((prev) => applyMessageToRadioState(prev, message));
  }, []);

  const fetchRadioState = useCallback(
    (targetChannel: string): Promise<void> => {
      if (targetChannel !== channelIdRef.current) {
        return Promise.resolve();
      }
      if (stateLoadRef.current?.channel === targetChannel) {
        return stateLoadRef.current.promise;
      }

      const requestId = ++stateRequestRef.current;
      stateAbortRef.current?.abort();
      const operation = new AbortController();
      stateAbortRef.current = operation;
      fetchInFlightRef.current = true;
      const attempts = loadedStateChannelRef.current === targetChannel ? 1 : 3;

      const run = async () => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (operation.signal.aborted) {
            return;
          }
          const controller = new AbortController();
          const cancel = () => controller.abort();
          operation.signal.addEventListener('abort', cancel, { once: true });
          let timedOut = false;
          let retryable = true;
          let failureMessage = 'Не удалось связаться с эфиром. Проверьте соединение и повторите.';
          const timeout = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, 15000);

          try {
            const requestedAt = Date.now();
            const res = await fetch(
              `/api/radio/state?channel=${encodeURIComponent(targetChannel)}`,
              { signal: controller.signal }
            );
            if (!res.ok) {
              retryable = res.status >= 500 || res.status === 408 || res.status === 429;
              failureMessage = `Не удалось получить эфир (HTTP ${res.status}). Повторите попытку.`;
              throw new Error(failureMessage);
            }

            const raw: unknown = await res.json().catch((error: unknown) => {
              if (error instanceof SyntaxError) {
                retryable = false;
                failureMessage = 'Сервер вернул некорректные данные эфира. Повторите попытку.';
              }
              throw error;
            });

            retryable = false;
            failureMessage = 'Сервер вернул некорректные данные эфира. Повторите попытку.';
            const receivedAt = Date.now();

            // User switched channel while this request was in flight: drop the stale answer.
            if (targetChannel !== channelIdRef.current || requestId !== stateRequestRef.current) {
              return;
            }

            const parsed = parseRadioStateResponse(raw, targetChannel, receivedAt);

            // Assume a symmetric network path: the server stamped its time half a round-trip ago.
            liveClock.observeOffset(parsed.serverNow - (requestedAt + receivedAt) / 2);

            setRadioState((prev) =>
              mergeRadioStateSnapshot(prev, parsed.state, parsed.socialRevision)
            );

            // Anchor the live clock; the key restarts the sub-second estimate when the set changes.
            const setKey = String(parsed.state.broadcast.setId);
            const durationSec = parsed.state.broadcast.durationSec;
            const positionSec = parsed.state.broadcast.positionSec;

            liveClock.observe(`${targetChannel}:${setKey}`, Number(positionSec), parsed.serverNow);
            anchorChannelRef.current = targetChannel;
            currentSetIdRef.current = setKey;
            durationRef.current = durationSec;
            setLivePositionSec(liveClock.getTargetSec());
            loadedStateChannelRef.current = targetChannel;
            setIsStateLoaded(true);
            setStateError('');

            onBroadcastSyncedRef.current(setKey);
            return;
          } catch (error) {
            if (
              operation.signal.aborted ||
              targetChannel !== channelIdRef.current ||
              requestId !== stateRequestRef.current
            ) {
              return;
            }
            if (!retryable && error instanceof Error && error.message) {
              failureMessage = error.message;
            }
            if (!(timedOut || retryable) || attempt === attempts - 1) {
              // A temporary refresh failure must not unload a valid, playing stream.
              if (loadedStateChannelRef.current !== targetChannel) {
                setIsStateLoaded(false);
              }
              setStateError(
                timedOut ? 'Эфир не ответил вовремя. Повторите попытку.' : failureMessage
              );
              return;
            }
          } finally {
            window.clearTimeout(timeout);
            operation.signal.removeEventListener('abort', cancel);
          }

          // Backoff belongs to this load and is cancelled on channel switch or unmount.
          await new Promise<void>((resolve) => {
            const finish = () => {
              window.clearTimeout(timer);
              operation.signal.removeEventListener('abort', finish);
              resolve();
            };
            const timer = window.setTimeout(finish, attempt === 0 ? 1000 : 2500);
            operation.signal.addEventListener('abort', finish, { once: true });
            if (operation.signal.aborted) {
              finish();
            }
          });
        }
      };

      const promise = run().finally(() => {
        if (requestId !== stateRequestRef.current) {
          return;
        }
        fetchInFlightRef.current = false;
        stateLoadRef.current = null;
        stateAbortRef.current = null;
      });
      stateLoadRef.current = { channel: targetChannel, promise };
      return promise;
    },
    [liveClock]
  );

  const switchChannelState = useCallback((next: string) => {
    channelIdRef.current = next;
    loadedStateChannelRef.current = '';
    setIsStateLoaded(false);
    setStateError('');
    setLivePositionSec(0);
    setChannelId(next);
  }, []);

  useEffect(() => {
    void fetchRadioState(channelId);
    return () => {
      ++stateRequestRef.current;
      stateAbortRef.current?.abort();
      stateAbortRef.current = null;
      stateLoadRef.current = null;
      fetchInFlightRef.current = false;
    };
  }, [channelId, fetchRadioState]);

  useEffect(() => {
    const recoverInitialState = () => {
      if (!document.hidden && loadedStateChannelRef.current !== channelIdRef.current) {
        void fetchRadioState(channelIdRef.current);
      }
    };
    window.addEventListener('online', recoverInitialState);
    document.addEventListener('visibilitychange', recoverInitialState);
    return () => {
      window.removeEventListener('online', recoverInitialState);
      document.removeEventListener('visibilitychange', recoverInitialState);
    };
  }, [fetchRadioState]);

  // Connect to Real-Time SSE stream (/api/radio/events)
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/radio/events?channel=${encodeURIComponent(channelId)}`);

      es.addEventListener('connected', () => {
        void fetchRadioState(channelId);
      });
      for (const event of ['moment:created', 'moment:liked']) {
        es.addEventListener(event, (ev: MessageEvent) => {
          try {
            applyMoment(JSON.parse(ev.data));
          } catch {
            // malformed event
          }
        });
      }
      for (const event of ['chat:message', 'chat:reaction']) {
        es.addEventListener(event, (ev: MessageEvent) => {
          try {
            applyMessage(JSON.parse(ev.data).message);
          } catch {
            // malformed event
          }
        });
      }
      es.addEventListener('listeners:update', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.channelId === channelId && typeof data.listenersCount === 'number') {
            setRadioState((prev) => ({ ...prev, listenersCount: data.listenersCount }));
          }
        } catch {
          // malformed event
        }
      });

      // Server heartbeat (every 8 s): authoritative on-air position for every channel.
      es.addEventListener('broadcast:tick', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          const mine = Array.isArray(data.channels)
            ? data.channels.find((c: { id?: string }) => c.id === channelId)
            : null;
          if (!mine) {
            return;
          }

          const serverMs = Number(data.serverTime);
          if (Number.isFinite(serverMs)) {
            // One-way latency only ever shrinks this sample; LiveClock keeps the best (largest) recent one.
            liveClock.observeOffset(serverMs - Date.now());
          }
          const setKey = String(mine.setId);
          if (
            currentSetIdRef.current &&
            setKey !== currentSetIdRef.current &&
            !fetchInFlightRef.current
          ) {
            // A new set went on air: pull the full state (new code, waveform, moments).
            void fetchRadioState(channelId);
            return;
          }
          if (Number.isFinite(serverMs)) {
            liveClock.observe(`${channelId}:${setKey}`, Number(mine.positionSec), serverMs);
          }
          if (typeof mine.listenersCount === 'number') {
            setRadioState((prev) =>
              prev.listenersCount === mine.listenersCount
                ? prev
                : { ...prev, listenersCount: mine.listenersCount }
            );
          }
        } catch {
          // ignore malformed tick
        }
      });
    } catch {
      // ignore
    }

    return () => {
      if (es) {
        es.close();
      }
    };
  }, [channelId, fetchRadioState, liveClock, applyMoment, applyMessage]);

  // Live clock → React state once a second. The position is derived from the server clock (not
  // incremented), so it stays correct even when the browser throttles timers in a background tab.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!liveClock.hasEstimate()) {
        return;
      }
      const dur = durationRef.current;
      if (!(dur > 0)) {
        return;
      }
      const pos = liveClock.getTargetSec();
      if (pos >= dur) {
        const now = Date.now();
        if (!fetchInFlightRef.current && now - lastRolloverFetchRef.current > 1500) {
          lastRolloverFetchRef.current = now;
          void fetchRadioState(channelIdRef.current);
        }
        setLivePositionSec(dur);
        return;
      }
      setLivePositionSec(pos);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [fetchRadioState, liveClock]);

  useEffect(() => {
    if (!isStateLoaded || radioState.peaks.length > 0) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void fetchRadioState(channelId);
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [isStateLoaded, radioState.peaks.length, channelId, fetchRadioState]);

  return {
    channelId,
    channelIdRef,
    radioState,
    stateError,
    isStateLoaded,
    livePositionSec,
    liveClock,
    anchorChannelRef,
    currentSetIdRef,
    durationRef,
    fetchInFlightRef,
    loadedStateChannelRef,
    fetchRadioState,
    switchChannelState,
    applyMoment,
    applyMessage,
  };
}
