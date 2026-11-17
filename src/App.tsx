import { safeStorage } from './utils/storage';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { EveningBackground, BackgroundHandle } from './components/EveningBackground';
import { AmbientHeader } from './components/AmbientHeader';
import { BackgroundMotionControl, FloatPanel, MagneticMark, SpatialMotionProvider } from './components/SpatialMotion';
import { StationWordmark } from './components/StationWordmark';
import { RadioMark } from './components/RadioMark';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioPreset,
  NEUTRAL_BANDS,
  NEUTRAL_MACROS,
  clampEqBands,
  clampEqGain,
  clampDspMacros,
  DspMacroState,
  radioDsp,
} from './audio/dspEngine';
import { LiveClock, LivePhaseLock, SyncSnapshot } from './audio/liveSync';
import {
  BlindMaskIcon,
  LiveBeaconIcon,
  PauseSignalIcon,
  PlaySignalIcon,
  RadioIcon,
  RadioIconName,
  ResyncLiveIcon,
  VolumeDspIcon,
} from './components/icons/RadioIcons';
import { AuthShieldModal } from './components/AuthShieldModal';
import { BootPreloader } from './components/BootPreloader';
import { DspEqualizerConsole } from './components/DspEqualizerConsole';
import { LiveEtherChat } from './components/LiveEtherChat';
import { WaveformTimeline } from './components/WaveformTimeline';
import {
  ChatMessageItem,
  RadioStatePayload,
  ReactionKind,
  UserSession,
  WaveformMoment,
} from './types/radio';
import { formatTimecode, solvePowChallenge } from './utils/pow';

const REACTION_TO_ICON: Record<ReactionKind, RadioIconName> = {
  fire: 'react-fire',
  hypnotic: 'react-hypnotic',
  subbass: 'react-subbass',
  goosebumps: 'react-goosebumps',
  acid: 'react-acid',
  heart: 'react-heart',
};

/** Order used by the lock-screen previous / next buttons. */
const CHANNEL_ORDER = ['ch-main', 'ch-deep', 'ch-afterglow'];

const MEDIA_ARTWORK_SIZES = [96, 128, 256, 512] as const;

function buildMediaArtwork(): MediaImage[] {
  return MEDIA_ARTWORK_SIZES.map((size) => ({
    src: new URL(`/brand/icon-${size}.png`, window.location.origin).href,
    sizes: `${size}x${size}`,
    type: 'image/png',
  }));
}

const IDLE_SYNC: SyncSnapshot = { state: 'idle', driftSec: 0, playbackRate: 1 };

function describeSync(
  snap: SyncSnapshot,
  isPlaying: boolean,
  audioBlocked: boolean
): { label: string; announce: string; tone: 'idle' | 'ok' | 'drift' | 'resync' | 'blocked' } {
  if (audioBlocked) {
    return { label: 'Нажмите «Слушать радио»', announce: 'Для запуска звука нажмите «Слушать радио»', tone: 'blocked' };
  }
  if (!isPlaying) {
    return { label: 'На паузе', announce: 'Ожидание', tone: 'idle' };
  }
  switch (snap.state) {
    case 'in-sync':
      return { label: 'В прямом эфире', announce: 'Синхронизация с эфиром', tone: 'ok' };
    case 'compensating':
      return { label: 'Подстраиваем эфир', announce: 'Подстраиваем воспроизведение', tone: 'drift' };
    case 'resync':
      return { label: 'Возвращаемся в эфир', announce: 'Возврат в живой эфир', tone: 'resync' };
    default:
      return { label: 'Подключаемся', announce: 'Подключаемся к эфиру', tone: 'idle' };
  }
}


const EMPTY_STATE: RadioStatePayload = {
  channelId: 'ch-main', channels: [],
  broadcast: { setId: '', code: '', frequency: '', sonicTag: '', durationSec: 0,
    positionSec: 0, startedAtMs: Date.now(), nextCode: '', startsInSec: 0, streamUrl: '' },
  peaks: [], heatmap: [], moments: [], messages: [], listenersCount: 0, serverTimeMs: Date.now(),
};
const CHANNEL_COPY: Record<string, { name: string; description: string }> = {
  'ch-main': { name: 'Основной', description: 'Deep-tech и tech. Ровный ритм городского вечера.' },
  'ch-deep': { name: 'Deep', description: 'Глубже в звук. Deep и мягкий бас.' },
  'ch-afterglow': { name: 'DeepTech', description: 'Медленнее, теплее. Музыка без спешки.' },
};

export const App: React.FC = () => {
  const theme = 'dusk';

  const [showBootloader, setShowBootloader] = useState(true);
  const [bootRevealed, setBootRevealed] = useState(false);
  const bootVisibleRef = useRef(true);
  const enteredRef = useRef(false);
  bootVisibleRef.current = showBootloader && !enteredRef.current;
  const contentRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<BackgroundHandle>(null);
  const [videoControlsHost, setVideoControlsHost] = useState<HTMLDivElement | null>(null);
  const [videoRetry, setVideoRetry] = useState(0);
  const [streamRevision, setStreamRevision] = useState(0);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [dockError, setDockError] = useState('');
  const [channelId, setChannelId] = useState<string>('ch-main');
  const [radioState, setRadioState] = useState<RadioStatePayload>(EMPTY_STATE);
  const reducedMotion = useReducedMotion();
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [stateError, setStateError] = useState('');
  const [isStateLoaded, setIsStateLoaded] = useState<boolean>(false);
  const [isAudioReady, setIsAudioReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [livePositionSec, setLivePositionSec] = useState<number>(0);
  const [syncSnapshot, setSyncSnapshot] = useState<SyncSnapshot>(IDLE_SYNC);
  const [audioBlocked, setAudioBlocked] = useState<boolean>(false);
  const [showMiniDock, setShowMiniDock] = useState<boolean>(false);

  // DSP Equalizer & Presets state
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [bands, setBands] = useState<number[]>([...NEUTRAL_BANDS]);
  const [macros, setMacros] = useState<DspMacroState>({
    ...NEUTRAL_MACROS,
    masterGain: 85,
  });
  const [isDspBypassed, setIsDspBypassed] = useState(true);
  const [customPresets, setCustomPresets] = useState<AudioPreset[]>(() => {
    try {
      const raw = safeStorage.getItem('radiotv_custom_presets');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string').map((p) => ({ ...p, bands: clampEqBands(Array.isArray(p.bands) ? p.bands : []), macros: clampDspMacros(p.macros || {}) })) : [];
    } catch {
      return [];
    }
  });

  // User Auth Session
  const [session, setSession] = useState<UserSession | null>(() => {
    try {
      const raw = safeStorage.getItem('radiotv_session');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const sessionRef = useRef(session);
  const sessionInFlight = useRef<Promise<UserSession> | null>(null);
  const actionsInFlight = useRef(new Set<string>());
  sessionRef.current = session;
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Live broadcast clock + phase lock
  const [liveClock] = useState(() => new LiveClock());
  const phaseLockRef = useRef<LivePhaseLock | null>(null);

  // Transport bookkeeping (refs: read from event handlers, never stale)
  const channelIdRef = useRef<string>('ch-main');
  const playIntentRef = useRef<boolean>(false);
  const transportEpochRef = useRef<number>(0);
  const playInFlightRef = useRef<Promise<boolean> | null>(null);
  const loadingRef = useRef<boolean>(false);
  const audioMetaLoadedRef = useRef<boolean>(false);
  const resumeAfterLoadRef = useRef<boolean>(false);
  const anchorChannelRef = useRef<string>('');
  const currentSetIdRef = useRef<string>('');
  const audioLoadedSetRef = useRef<string | null>(null);
  const stateRequestRef = useRef(0);
  const stateAbortRef = useRef<AbortController | null>(null);
  const fetchInFlightRef = useRef<boolean>(false);
  const stateLoadRef = useRef<{ channel: string; promise: Promise<void> } | null>(null);
  const loadedStateChannelRef = useRef<string>('');
  const lastRolloverFetchRef = useRef<number>(0);
  const durationRef = useRef<number>(EMPTY_STATE.broadcast.durationSec);
  const startPlaybackRef = useRef<() => Promise<boolean>>(async () => false);
  const reloadStreamRef = useRef<() => void>(() => {});
  const maybeResumeAfterLoadRef = useRef<() => void>(() => {});

  // Apply active theme to <html data-theme="...">
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    safeStorage.setItem('radiotv_theme', theme);
  }, [theme]);

  // The intro owns the viewport until its doors finish opening.
  useEffect(() => {
    if (!showBootloader) return;
    const html = document.documentElement;
    const previous = { overflow: document.body.style.overflow, scrollBehavior: html.style.scrollBehavior, restoration: history.scrollRestoration };
    document.body.style.overflow = 'hidden';
    html.style.scrollBehavior = 'auto';
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    const frame = requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previous.overflow;
      html.style.scrollBehavior = previous.scrollBehavior;
      history.scrollRestoration = previous.restoration;
    };
  }, [showBootloader]);

  // IntersectionObserver for scroll choreography + floating glass mini-dock visibility
  useEffect(() => {
    const sections = document.querySelectorAll('.scroll-reveal-section');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-inview');
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    sections.forEach((sec) => observer.observe(sec));

    const hero = document.getElementById('ether-stage');
    const dockObserver = new IntersectionObserver(([entry]) => setShowMiniDock(!entry.isIntersecting));
    if (hero) dockObserver.observe(hero);
    return () => { observer.disconnect(); dockObserver.disconnect(); };
  }, []);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    safeStorage.removeItem('radiotv_session');
    setAuthModalOpen(true);
  }, []);

  const ensureSession = useCallback(async (): Promise<UserSession> => {
    if (sessionInFlight.current) return sessionInFlight.current;
    const job = (async () => {
      const saved = sessionRef.current;
      if (saved?.token) {
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${saved.token}` } });
        if (res.status === 401) {
          clearSession();
          throw new Error('Сессия истекла. Войдите снова и повторите действие.');
        }
        if (!res.ok) throw new Error('Не удалось проверить сессию. Повторите позже.');
        return saved;
      }
      const challengeRes = await fetch('/api/auth/challenge');
      if (!challengeRes.ok) throw new Error('Не удалось начать гостевой вход.');
      const challenge = await challengeRes.json();
      const solved = await solvePowChallenge(challenge.prefix, challenge.difficulty || 3);
      const res = await fetch('/api/auth/guest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: challenge.challengeId, nonce: solved.nonce }),
      });
      const data = await res.json();
      if (!res.ok || !data.session?.token) throw new Error(data.error || 'Не удалось войти.');
      const user: UserSession = data.session;
      sessionRef.current = user;
      setSession(user);
      safeStorage.setItem('radiotv_session', JSON.stringify(user));
      return user;
    })();
    sessionInFlight.current = job;
    try { return await job; } finally { sessionInFlight.current = null; }
  }, [clearSession]);

  const applyMoment = useCallback((data: { moment: WaveformMoment; heatmap?: number[] }) => {
    const moment = data.moment;
    if (!moment || !Number.isSafeInteger(moment.id)) return;
    setRadioState((prev) => {
      if (String(moment.setId) !== String(prev.broadcast.setId)) return prev;
      const existing = prev.moments.find((item) => item.id === moment.id);
      if ((existing?.revision || 0) > (moment.revision || 0)) return prev;
      const updated = { ...moment, likesCount: Math.max(moment.likesCount, existing?.likesCount || 0) };
      const moments = [...prev.moments.filter((item) => item.id !== moment.id), updated]
        .sort((a, b) => a.timestampSec - b.timestampSec || a.id - b.id);
      return { ...prev, moments, heatmap: data.heatmap || prev.heatmap };
    });
  }, []);

  const applyMessage = useCallback((message: ChatMessageItem) => {
    if (!message || !Number.isSafeInteger(message.id)) return;
    setRadioState((prev) => {
      const existing = prev.messages.find((item) => item.id === message.id);
      if ((existing?.revision || 0) > (message.revision || 0)) return prev;
      return { ...prev, messages: [...prev.messages.filter((item) => item.id !== message.id), message]
        .sort((a, b) => a.id - b.id).slice(-50) };
    });
  }, []);

  // Fetch live radio state for current channel
  const fetchRadioState = useCallback((targetChannel: string): Promise<void> => {
    if (targetChannel !== channelIdRef.current) return Promise.resolve();
    if (stateLoadRef.current?.channel === targetChannel) return stateLoadRef.current.promise;

    const requestId = ++stateRequestRef.current;
    stateAbortRef.current?.abort();
    const operation = new AbortController();
    stateAbortRef.current = operation;
    fetchInFlightRef.current = true;
    const attempts = loadedStateChannelRef.current === targetChannel ? 1 : 3;
    const run = async () => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (operation.signal.aborted) return;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        operation.signal.addEventListener('abort', cancel, { once: true });
        let timedOut = false;
        let retryable = true;
        let failureMessage = 'Не удалось связаться с эфиром. Проверьте соединение и повторите.';
        const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
        try {
          const requestedAt = Date.now();
          const res = await fetch(
            `/api/radio/state?channel=${encodeURIComponent(targetChannel)}`, { signal: controller.signal }
          );
          if (!res.ok) {
            retryable = res.status >= 500 || res.status === 408 || res.status === 429;
            failureMessage = `Не удалось получить эфир (HTTP ${res.status}). Повторите попытку.`;
            throw new Error(failureMessage);
          }
          const raw = await res.json().catch((error: unknown) => {
            if (error instanceof SyntaxError) {
              retryable = false;
              failureMessage = 'Сервер вернул некорректные данные эфира. Повторите попытку.';
            }
            throw error;
          });
          retryable = false;
          failureMessage = 'Сервер вернул некорректные данные эфира. Повторите попытку.';
          if (!raw || typeof raw !== 'object') throw new Error(failureMessage);
          const receivedAt = Date.now();

          // User switched channel while this request was in flight: drop the stale answer.
          if (targetChannel !== channelIdRef.current || requestId !== stateRequestRef.current) return;

          const serverNow = raw.serverTimeMs || raw.serverTime || receivedAt;
          const b = raw.broadcast || {};
          if (b.available === false) {
            failureMessage = 'Эфир пока недоступен. Попробуйте ещё раз позже.';
            throw new Error(failureMessage);
          }
          if (raw.ok !== true || !b.setId ||
              !Number.isFinite(b.durationSec) || b.durationSec <= 0 ||
              !Number.isFinite(b.positionSec) || b.positionSec < 0 || b.positionSec > b.durationSec ||
              typeof b.streamUrl !== 'string' || !b.streamUrl.startsWith('/api/radio/stream/') ||
              !Array.isArray(raw.channels) || !raw.channels.some((c: { id?: string }) => c.id === targetChannel)) {
            throw new Error(failureMessage);
          }
          // Assume a symmetric network path: the server stamped its time half a round-trip ago.
          liveClock.observeOffset(serverNow - (requestedAt + receivedAt) / 2);
          const durationSec = b.durationSec ?? b.duration_sec ?? 0;
          const positionSec = b.positionSec ?? b.position_sec ?? 0;
          const setId = b.setId ?? b.set_id ?? 1;

          const normalizedMoments: WaveformMoment[] = (
            raw.moments ||
            b.moments ||
            []
          ).map((m: Record<string, unknown>, idx: number) => ({
            revision: Number(raw.socialRevision || 0),
            id: Number(m.id ?? idx + 1),
            setId: (m.setId ?? m.set_id ?? setId) as string | number,
            callsign: String(m.callsign ?? 'Гость'),
            avatarColor: String(m.avatarColor ?? m.avatar_color ?? '#38BDF8'),
            timestampSec: Number(m.timestampSec ?? m.timestamp_sec ?? 0),
            reactionType: (m.reactionType ??
              m.reaction_type ??
              'fire') as ReactionKind,
            comment: String(m.comment ?? ''),
            likesCount: Number(m.likesCount ?? m.likes_count ?? 0),
            createdAt: String(m.createdAt ?? m.created_at ?? ''),
          }));

          const normalizedMessages: ChatMessageItem[] = (raw.messages || []).map(
            (msg: Record<string, unknown>, idx: number) => ({
              revision: Number(raw.socialRevision || 0),
              id: Number(msg.id ?? idx + 1),
              channelId: String(msg.channelId ?? msg.channel_id ?? targetChannel),
              callsign: String(msg.callsign ?? 'Гость'),
              avatarColor: String(msg.avatarColor ?? msg.avatar_color ?? '#38BDF8'),
              text: String(msg.text ?? ''),
              setCode: String(
                msg.setCode ?? msg.set_code ?? b.code ?? ''
              ),
              setTimestampSec: Number(
                msg.setTimestampSec ?? msg.set_timestamp_sec ?? positionSec
              ),
              reactions: (msg.reactions ?? {}) as Partial<
                Record<ReactionKind, number>
              >,
              createdAt: String(msg.createdAt ?? msg.created_at ?? ''),
            })
          );

          const nextState: RadioStatePayload = {
            channelId: targetChannel,
            channels:
              Array.isArray(raw.channels) && raw.channels.length > 0
                ? raw.channels
                : EMPTY_STATE.channels,
            broadcast: {
              setId,
              code: b.code || '',
              frequency: b.frequency || '',
              sonicTag:
                b.sonicTag || b.sonic_tag || '',
              durationSec,
              positionSec,
              startedAtMs:
                b.startedAtMs || Date.now() - Math.floor(positionSec * 1000),
              nextCode: b.nextCode ?? b.next_code ?? '',
              startsInSec:
                b.startsInSec ??
                b.starts_in_sec ??
                Math.max(10, durationSec - positionSec),
              streamUrl: b.streamUrl ?? '',
            },
            peaks: Array.isArray(raw.peaks)
              ? raw.peaks
              : Array.isArray(b.peaks)
                ? b.peaks
                : [],
            heatmap: Array.isArray(raw.heatmap)
              ? raw.heatmap
              : Array.isArray(b.heatmap)
                ? b.heatmap
                : [],
            moments: normalizedMoments,
            messages: normalizedMessages,
            listenersCount: Number(
              raw.listenersCount ?? raw.listeners_count ?? 0
            ),
            serverTimeMs: serverNow,
          };

          setRadioState((prev) => {
            // Preserve events received while this snapshot was in flight.
            const merge = <T extends { id: number; revision?: number }>(snapshot: T[], current: T[]): T[] => {
              const rows = new Map(snapshot.map((row) => [row.id, row]));
              for (const row of current) if ((row.revision || 0) > Number(raw.socialRevision || 0)) rows.set(row.id, row);
              return [...rows.values()];
            };
            return { ...nextState,
              heatmap: prev.moments.some((m) => String(m.setId) === String(setId) &&
                (m.revision || 0) > Number(raw.socialRevision || 0)) ? prev.heatmap : nextState.heatmap,
              messages: merge(nextState.messages, prev.messages).sort((a, b) => a.id - b.id).slice(-50),
              moments: merge(nextState.moments, prev.moments.filter((m) => String(m.setId) === String(setId)))
                .sort((a, b) => a.timestampSec - b.timestampSec || a.id - b.id),
            };
          });

          // Anchor the live clock; the key restarts the sub-second estimate when the set changes.
          const setKey = String(setId);
          liveClock.observe(`${targetChannel}:${setKey}`, Number(positionSec), serverNow);
          anchorChannelRef.current = targetChannel;
          currentSetIdRef.current = setKey;
          durationRef.current = durationSec;
          setLivePositionSec(liveClock.getTargetSec());
          loadedStateChannelRef.current = targetChannel;
          setIsStateLoaded(true);
          setStateError('');

          if (audioMetaLoadedRef.current) {
            if (audioLoadedSetRef.current === null) {
              // Audio finished loading before we knew the set; it was requested after the switch, so it matches.
              audioLoadedSetRef.current = setKey;
            } else if (audioLoadedSetRef.current !== setKey) {
              // The server rolled over to the next set: the element still holds the old file.
              reloadStreamRef.current();
              return;
            }
          }
          maybeResumeAfterLoadRef.current();
          return;
        } catch {
          if (operation.signal.aborted || targetChannel !== channelIdRef.current || requestId !== stateRequestRef.current) return;
          if (!(timedOut || retryable) || attempt === attempts - 1) {
            // A temporary refresh failure must not unload a valid, playing stream.
            if (loadedStateChannelRef.current !== targetChannel) {
              setIsStateLoaded(false);
              setIsAudioReady(false);
            }
            setStateError(timedOut
              ? 'Эфир не ответил вовремя. Повторите попытку.' : failureMessage);
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
          if (operation.signal.aborted) finish();
        });
      }
    };
    const promise = run().finally(() => {
      if (requestId !== stateRequestRef.current) return;
      fetchInFlightRef.current = false;
      stateLoadRef.current = null;
      stateAbortRef.current = null;
    });
    stateLoadRef.current = { channel: targetChannel, promise };
    return promise;
  }, [liveClock]);


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
      es = new EventSource(
        `/api/radio/events?channel=${encodeURIComponent(channelId)}`
      );

      es.addEventListener('connected', () => { void fetchRadioState(channelId); });
      for (const event of ['moment:created', 'moment:liked']) {
        es.addEventListener(event, (ev: MessageEvent) => {
          try { applyMoment(JSON.parse(ev.data)); } catch { /* malformed event */ }
        });
      }
      for (const event of ['chat:message', 'chat:reaction']) {
        es.addEventListener(event, (ev: MessageEvent) => {
          try { applyMessage(JSON.parse(ev.data).message); } catch { /* malformed event */ }
        });
      }
      es.addEventListener('listeners:update', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.channelId === channelId && typeof data.listenersCount === 'number') {
            setRadioState((prev) => ({ ...prev, listenersCount: data.listenersCount }));
          }
        } catch { /* malformed event */ }
      });

      // Server heartbeat (every 8 s): authoritative on-air position for every channel.
      es.addEventListener('broadcast:tick', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          const mine = Array.isArray(data.channels)
            ? data.channels.find((c: { id?: string }) => c.id === channelId)
            : null;
          if (!mine) return;

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
      if (es) es.close();
    };
  }, [channelId, fetchRadioState, liveClock, applyMoment, applyMessage]);

  // Live clock → React state once a second. The position is derived from the server clock (not
  // incremented), so it stays correct even when the browser throttles timers in a background tab.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!liveClock.hasEstimate()) return;
      const dur = durationRef.current;
      if (!(dur > 0)) return;
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

  // Phase lock: keeps <audio> glued to the live position (rate nudges, micro-faded seek on big drift)
  useEffect(() => {
    const lock = new LivePhaseLock({
      getAudio: () => audioRef.current,
      getTargetSec: () => liveClock.getTargetSec(),
      getDurationSec: () => durationRef.current,
      onChange: setSyncSnapshot,
    });
    phaseLockRef.current = lock;
    lock.start();
    return () => {
      lock.stop();
      phaseLockRef.current = null;
    };
  }, [liveClock]);

  const syncAudioToLiveClock = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // No server fix yet, or the fix belongs to another channel: seeking now would land in the wrong place.
    if (!liveClock.hasEstimate() || anchorChannelRef.current !== channelIdRef.current) return;
    const mediaDuration =
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
    const limit = Math.min(durationRef.current, mediaDuration) - 0.5;
    try {
      audio.currentTime = Math.max(0, Math.min(liveClock.getTargetSec(), limit));
    } catch {
      // metadata not ready; the phase lock will correct once playback starts
    }
  }, [liveClock]);

  const startPlayback = useCallback((): Promise<boolean> => {
    const audio = audioRef.current;
    if (!audio || !enteredRef.current) return Promise.resolve(false);
    // A gesture handler and a button onClick can both fire for one tap: share one attempt.
    if (playInFlightRef.current) return playInFlightRef.current;

    const run = async (): Promise<boolean> => {
      const epoch = ++transportEpochRef.current;
      playIntentRef.current = true;
      radioDsp.setPlaybackIntent(true);
      if (!radioDsp.initAndAttach(audio)) {
        playIntentRef.current = false;
        radioDsp.setPlaybackIntent(false);
        setAudioBlocked(true);
        return false;
      }
      radioDsp.setBands(bands);
      radioDsp.setMacros(macros);
      radioDsp.setBypass(isDspBypassed);

      // iOS: resume() and play() must both be issued synchronously inside the gesture task.
      const contextReady = radioDsp.resume(true);
      audio.muted = false;
      syncAudioToLiveClock();

      let playTimeout: number | undefined;
      try {
        const played = audio.play();
        await Promise.race([played, new Promise<never>((_, reject) => {
          playTimeout = window.setTimeout(() => reject(new Error('Playback timed out')), 8000);
        })]);
      } catch (err) {
        if (epoch !== transportEpochRef.current) return false;
        const name = (err as { name?: string } | null)?.name;
        if (name === 'AbortError') {
          // play() was cut short by load() or pause(). A pending reload re-issues it from loadedmetadata.
          return false;
        }
        if (name === 'NotAllowedError') {
          // Autoplay policy: keep the intent so the next tap / click retries inside a real gesture.
          setIsPlaying(false);
          setAudioBlocked(true);
          return false;
        }
        playIntentRef.current = false;
        radioDsp.setPlaybackIntent(false);
        setIsPlaying(false);
        audio.pause();
        return false;
      } finally { window.clearTimeout(playTimeout); }

      const running = await contextReady;
      if (epoch !== transportEpochRef.current || !playIntentRef.current || audio.paused) return false;
      if (!running) {
        setIsPlaying(false);
        setAudioBlocked(true);
        return false;
      }
      loadingRef.current = false;
      setIsPlaying(true);
      setAudioBlocked(false);
      return true;
    };

    const attempt = run().finally(() => {
      if (playInFlightRef.current === attempt) playInFlightRef.current = null;
    });
    playInFlightRef.current = attempt;
    return attempt;
  }, [bands, macros, isDspBypassed, syncAudioToLiveClock]);

  const pausePlayback = useCallback(() => {
    const audio = audioRef.current;
    const epoch = ++transportEpochRef.current;
    playIntentRef.current = false;
    resumeAfterLoadRef.current = false;
    radioDsp.setPlaybackIntent(false);
    setIsPlaying(false);
    setAudioBlocked(false);
    phaseLockRef.current?.reset();
    if (!audio) return;

    // Background tabs get throttled timers (and may be frozen right after a lock-screen tap): pause at once.
    if (document.visibilityState === 'hidden') {
      audio.pause();
      return;
    }
    // 15 ms fade-out first so the pause does not click; a new play() in between cancels the pause.
    radioDsp.fadeOut(15);
    window.setTimeout(() => {
      if (transportEpochRef.current === epoch) audio.pause();
    }, 20);
  }, []);

  const reloadStream = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    loadingRef.current = true;
    ++transportEpochRef.current;
    playInFlightRef.current = null;
    setIsPlaying(false);
    audioMetaLoadedRef.current = false;
    audioLoadedSetRef.current = null;
    resumeAfterLoadRef.current = playIntentRef.current;
    phaseLockRef.current?.reset();
    setIsAudioReady(false);
    setAudioError('');
    setStreamRevision((value) => value + 1);
  }, []);

  /** Re-starts playback after a channel switch / set rollover once the new stream and clock are ready. */
  const maybeResumeAfterLoad = useCallback(() => {
    if (!resumeAfterLoadRef.current || !audioMetaLoadedRef.current) return;
    if (anchorChannelRef.current !== channelIdRef.current) return; // wait for the new channel's state
    resumeAfterLoadRef.current = false;
    loadingRef.current = false;
    void startPlaybackRef.current();
  }, []);

  // Every channel switch goes through here so the transport flags are set before React swaps <audio src>
  const selectChannel = useCallback((next: string) => {
    if (next === channelIdRef.current) return;
    channelIdRef.current = next;
    loadingRef.current = true;
    ++transportEpochRef.current;
    playInFlightRef.current = null;
    setIsPlaying(false);
    audioMetaLoadedRef.current = false;
    audioLoadedSetRef.current = null;
    resumeAfterLoadRef.current = playIntentRef.current;
    phaseLockRef.current?.reset();
    setIsAudioReady(false);
    loadedStateChannelRef.current = '';
    setIsStateLoaded(false);
    setStateError('');
    setAudioError('');
    setLivePositionSec(0);
    setChannelId(next);
  }, []);

  startPlaybackRef.current = startPlayback;
  reloadStreamRef.current = reloadStream;
  maybeResumeAfterLoadRef.current = maybeResumeAfterLoad;

  const togglePlay = async () => {
    if (isPlaying) {
      pausePlayback();
    } else {
      await startPlayback();
    }
  };

  const handleResyncLive = async () => {
    await fetchRadioState(channelIdRef.current);
    const audio = audioRef.current;
    if (audio && playIntentRef.current && !audio.paused) {
      await phaseLockRef.current?.forceResync();
    } else {
      await startPlayback();
    }
  };

  // ── <audio> element events ──
  const handleAudioLoadedMetadata = () => {
    audioMetaLoadedRef.current = true;
    audioLoadedSetRef.current =
      anchorChannelRef.current === channelIdRef.current ? currentSetIdRef.current || null : null;
    if (resumeAfterLoadRef.current) {
      maybeResumeAfterLoadRef.current();
      return;
    }
    loadingRef.current = false;
    syncAudioToLiveClock();
  };

  const handleAudioPlay = () => {
    if (!enteredRef.current || (bootVisibleRef.current && !playIntentRef.current)) return;
    if (playIntentRef.current) return; // started by us
    // Resumed by the system (headset button, interruption ended). Follow it, and ramp the bus back in
    // because our own pause leaves the fade stage at silence.
    playIntentRef.current = true;
    radioDsp.setPlaybackIntent(true);
    const epoch = transportEpochRef.current;
    void radioDsp.resume(true).then((running) => {
      if (epoch !== transportEpochRef.current || !playIntentRef.current || audioRef.current?.paused) return;
      setIsPlaying(running);
      setAudioBlocked(!running);
    });
  };

  const handleAudioPause = () => {
    if (loadingRef.current) return;
    if (audioRef.current?.ended) return;
    if (!playIntentRef.current) return; // our own pause: pausePlayback() already updated everything
    // A pause nobody asked for (phone call, headset unplugged, OS decision): reflect it honestly.
    ++transportEpochRef.current;
    playInFlightRef.current = null;
    resumeAfterLoadRef.current = false;
    playIntentRef.current = false;
    radioDsp.setPlaybackIntent(false);
    setIsPlaying(false);
  };

  const handleAudioError = () => {
    setIsAudioReady(false);
    setAudioError('Не удалось загрузить звук. Проверьте соединение и повторите.');
    loadingRef.current = false;
    resumeAfterLoadRef.current = false;
    if (playIntentRef.current) {
      playIntentRef.current = false;
      radioDsp.setPlaybackIntent(false);
      setIsPlaying(false);
    }
  };

  const handleAudioEnded = () => {
    // The set finished; the server now serves the next one from the same URL, so the element must reload.
    resumeAfterLoadRef.current = playIntentRef.current;
    void fetchRadioState(channelIdRef.current).then(() => {
      if (audioMetaLoadedRef.current) reloadStreamRef.current();
    });
  };

  // ── iOS / Android audio-policy resilience ──
  // Explicit play buttons own activation, avoiding capture/click races and unrelated taps.
  // The engine also reports a delayed resume after an interruption or policy refusal.
  useEffect(
    () =>
      radioDsp.subscribe((event) => {
        setAudioBlocked(event === 'blocked');
        if (event === 'blocked') setIsPlaying(false);
        else if (enteredRef.current && playIntentRef.current && audioRef.current && !audioRef.current.paused) {
          setIsPlaying(true);
        }
      }),
    []
  );

  // Keep the audio session in playback mode; stop timer-driven corrections while hidden.
  useEffect(() => {
    const keepAlive = () => {
      phaseLockRef.current?.checkNow();
      if (playIntentRef.current) void radioDsp.resume(false);
    };
    const recover = async () => {
      const audio = audioRef.current;
      if (!audio || !playIntentRef.current) return;
      // SSE ticks may have been missed in the background: re-anchor the live clock.
      if (!fetchInFlightRef.current) void fetchRadioState(channelIdRef.current);
      if (audio.paused && !audio.ended && !loadingRef.current) {
        await startPlaybackRef.current();
      } else {
        const running = await radioDsp.resume(false);
        if (!playIntentRef.current) return;
        setAudioBlocked(!running);
        setIsPlaying(running && !audio.paused);
        phaseLockRef.current?.checkNow();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') keepAlive();
      else void recover();
    };
    const onPageHide = () => keepAlive();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void recover(); // restored from the back/forward cache
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [fetchRadioState]);

  // ── Media Session (lock screen / Control Center / headset buttons) ──
  const mediaHandlersRef = useRef({
    play: () => {},
    pause: () => {},
    step: (_delta: number) => {},
    resync: () => {},
  });
  mediaHandlersRef.current = {
    play: () => {
      void startPlayback();
    },
    pause: pausePlayback,
    step: (delta: number) => {
      const idx = Math.max(0, CHANNEL_ORDER.indexOf(channelIdRef.current));
      selectChannel(CHANNEL_ORDER[(idx + delta + CHANNEL_ORDER.length) % CHANNEL_ORDER.length]);
    },
    // It is a live stream: any scrub on the lock screen simply means "take me back to the live point".
    resync: () => {
      void phaseLockRef.current?.forceResync();
    },
  };

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // action not supported by this browser
      }
    };
    bind('play', () => mediaHandlersRef.current.play());
    bind('pause', () => mediaHandlersRef.current.pause());
    bind('stop', () => mediaHandlersRef.current.pause());
    bind('previoustrack', () => mediaHandlersRef.current.step(-1));
    bind('nexttrack', () => mediaHandlersRef.current.step(1));
    bind('seekto', () => mediaHandlersRef.current.resync());
    // Skip-15s buttons make no sense on a live ether; leaving them unbound keeps the UI clean.
    bind('seekbackward', null);
    bind('seekforward', null);
    return () => {
      (
        ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekto'] as MediaSessionAction[]
      ).forEach((action) => bind(action, null));
    };
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    // Wait until the state belongs to the channel we are tuned to, otherwise the lock screen flashes old data.
    if (radioState.channelId !== channelId) return;
    const channel = radioState.channels.find((c) => c.id === channelId);
    const sonicTag = 'Deep-tech · tech · deep · downtempo';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'ToniVecherRadio',
      artist: channel ? (CHANNEL_COPY[channel.id]?.name || channel.name) : 'Прямой эфир',
      album: sonicTag,
      artwork: buildMediaArtwork(),
    });
  }, [
    channelId,
    isPlaying,
    radioState.channelId,
    radioState.channels,
    radioState.broadcast.code,
    radioState.broadcast.frequency,
    radioState.broadcast.sonicTag,
  ]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : enteredRef.current ? 'paused' : 'none';
  }, [isPlaying]);

  const positionStateBucket = Math.floor(livePositionSec / 5);
  useEffect(() => {
    if (!('mediaSession' in navigator) || !liveClock.hasEstimate()) return;
    const duration = radioState.broadcast.durationSec;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.max(0, Math.min(duration, liveClock.getTargetSec())),
      });
    } catch {
      // position outside duration or unsupported
    }
  }, [positionStateBucket, radioState.broadcast.durationSec, liveClock]);

  const handleDspBypass = (bypassed: boolean) => {
    setIsDspBypassed(bypassed);
    radioDsp.setBypass(bypassed);
  };

  const handleResetFlat = () => {
    const neutral = { ...NEUTRAL_MACROS, masterGain: macros.masterGain };
    setActivePresetId('');
    setBands([...NEUTRAL_BANDS]);
    setMacros(neutral);
    radioDsp.setBands([...NEUTRAL_BANDS]);
    radioDsp.setMacros(neutral);
    handleDspBypass(true);
  };

  const handleSelectPreset = (preset: AudioPreset) => {
    if (preset.id === 'flat') { handleResetFlat(); return; }
    const nextBands = clampEqBands(preset.bands);
    const nextMacros = clampDspMacros({ ...preset.macros, masterGain: macros.masterGain });
    setActivePresetId(preset.id);
    setBands(nextBands);
    setMacros(nextMacros);
    radioDsp.setBands(nextBands);
    radioDsp.setMacros(nextMacros);
    handleDspBypass(false);
  };

  const handleBandChange = (idx: number, gainDb: number) => {
    const gain = clampEqGain(gainDb);
    setBands((prev) => prev.map((value, i) => i === idx ? gain : value));
    setActivePresetId('custom_live');
    radioDsp.setBandGain(idx, gain);
    handleDspBypass(false);
  };

  const handleMacroChange = (patch: Partial<DspMacroState>) => {
    const next = clampDspMacros({ ...macros, ...patch });
    setMacros(next);
    radioDsp.setMacros(next);
    if (Object.keys(patch).some((key) => key !== 'masterGain')) {
      setActivePresetId('custom_live');
      handleDspBypass(false);
    }
  };

  const handleSaveCustomPreset = (name: string) => {
    const newPreset: AudioPreset = {
      id: `user_${Date.now()}`,
      name,
      subtitle: 'Пользовательский профиль эквалайзера',
      bands: [...bands],
      macros: {
        subBass: macros.subBass,
        warmthDrive: macros.warmthDrive,
        airPresence: macros.airPresence,
        compGlue: macros.compGlue,
      },
      isCustom: true,
    };
    const nextList = [...customPresets, newPreset];
    setCustomPresets(nextList);
    setActivePresetId(newPreset.id);
    safeStorage.setItem('radiotv_custom_presets', JSON.stringify(nextList));
  };

  const postAction = async (key: string, url: string, body: object) => {
    if (actionsInFlight.current.has(key)) throw new Error('Действие уже отправляется.');
    actionsInFlight.current.add(key);
    try {
      const activeUser = await ensureSession();
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeUser.token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 401) clearSession();
      if (!res.ok || data.ok !== true) throw new Error(data.error || 'Действие не сохранено. Повторите позже.');
      return data;
    } catch (error) {
      if (error instanceof TypeError) throw new Error('Нет связи с сервером. Проверьте соединение и повторите.');
      throw error;
    } finally { actionsInFlight.current.delete(key); }
  };

  const handleDropMoment = async (timestampSec: number, reactionType: ReactionKind, comment: string) => {
    const data = await postAction('moment', '/api/radio/moments', {
      channelId, setId: radioState.broadcast.setId, timestampSec, reactionType, comment,
    });
    applyMoment(data);
  };
  const handleLikeMoment = async (momentId: number) => {
    const data = await postAction(`like:${momentId}`, `/api/radio/moments/${momentId}/react`, {});
    applyMoment(data);
  };
  const handleSendMessage = async (text: string) => {
    const data = await postAction('chat', '/api/radio/chat', { channelId, text });
    applyMessage(data.message);
  };
  const handleReactToMessage = async (messageId: number, kind: ReactionKind) => {
    const data = await postAction(`react:${messageId}`, `/api/radio/chat/${messageId}/react`, { reactionType: kind });
    applyMessage(data.message);
  };

  const renderReactionIcon = useCallback((kind: ReactionKind, size = 16) => {
    const iconName = REACTION_TO_ICON[kind] || 'react-fire';
    return <RadioIcon name={iconName} size={size} />;
  }, []);

  const updateVolumeFromClientX = (el: HTMLDivElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    handleMacroChange({ masterGain: Math.round(ratio * 100) });
  };

  const audioSource = isStateLoaded && radioState.channelId === channelId && radioState.broadcast.setId
    ? `/api/radio/stream/${channelId}?set=${encodeURIComponent(String(radioState.broadcast.setId))}&load=${streamRevision}`
    : undefined;
  const bootStateError = audioSource ? '' : stateError;

  // Metadata is insufficient: seek to the actual broadcast point, then require decoded,
  // buffered data around that point. A stalled resource stays blocked until recovery.
  useEffect(() => {
    const audio = audioRef.current;
    setIsAudioReady(false);
    if (!audio || !audioSource) return;
    let active = true;
    let ready = false;
    let waitingSince = Date.now();
    let lastSeekAt = 0;
    let lastPrepareAt = 0;
    const expected = new URL(audioSource, window.location.href).href;
    const check = () => {
      if (!active) return;
      if (bootVisibleRef.current && document.hidden) {
        audio.pause();
        waitingSince = Date.now();
        return;
      }
      if (!ready && Date.now() - waitingSince > 20000) {
        setAudioError('Звук загружается слишком долго. Нажмите «Подготовить» или повторите загрузку.');
        setNeedsGesture(true);
      }
      if (audio.currentSrc !== expected || !audioMetaLoadedRef.current) return;
      const target = Math.max(0, Math.min(liveClock.getTargetSec(), audio.duration - 0.5));
      if ((bootVisibleRef.current || !ready) && !audio.seeking &&
          Math.abs(audio.currentTime - target) > 1.2 && Date.now() - lastSeekAt > 1200) {
        lastSeekAt = Date.now();
        audio.currentTime = target;
        return;
      }
      const point = bootVisibleRef.current || !ready ? target : audio.currentTime;
      // HAVE_ENOUGH_DATA is the browser's playback estimate. Paused AAC streams
      // can stop fetching with a short reserve, so verify a real second there.
      const reserve = audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA ? 1 : 3;
      let buffered = false;
      for (let i = 0; i < audio.buffered.length; i++) {
        if (audio.buffered.start(i) <= Math.max(0, point - 0.15) &&
            audio.buffered.end(i) >= Math.min(audio.duration - 0.1, point + reserve)) buffered = true;
      }
      const next = !audio.error && !audio.seeking && audio.readyState >= 3 && buffered &&
        (!(bootVisibleRef.current || !ready) || Math.abs(audio.currentTime - target) <= 1.2);
      if (next) {
        if (!ready) { ready = true; setIsAudioReady(true); setAudioError(''); setNeedsGesture(false); }
        waitingSince = Date.now();
      } else {
        if (ready) { ready = false; setIsAudioReady(false); }
        // Some browsers stop paused preloading before the required reserve.
        // Keep preparation silent and moving with the live clock until entry.
        if (bootVisibleRef.current && audio.paused && !audio.seeking && Date.now() - lastPrepareAt > 3000) {
          lastPrepareAt = Date.now();
          audio.muted = true;
          void audio.play().catch(() => { if (active) setNeedsGesture(true); });
        }
        if (Date.now() - waitingSince > 20000) {
          setAudioError('Звук загружается слишком долго. Нажмите «Подготовить» или повторите загрузку.');
          setNeedsGesture(true);
        }
      }
    };
    const events = ['canplay', 'progress', 'seeked', 'loadeddata', 'waiting', 'stalled'] as const;
    events.forEach((name) => audio.addEventListener(name, check));
    const interval = window.setInterval(check, 250);
    check();
    return () => { active = false; window.clearInterval(interval); events.forEach((name) => audio.removeEventListener(name, check)); };
  }, [audioSource, liveClock]);

  useEffect(() => {
    if (isStateLoaded && radioState.peaks.length === 0) {
      const timer = window.setInterval(() => { if (!document.hidden) void fetchRadioState(channelId); }, 15000);
      return () => window.clearInterval(timer);
    }
  }, [isStateLoaded, radioState.peaks.length, channelId, fetchRadioState]);

  useEffect(() => {
    if (!showBootloader) contentRef.current?.querySelector<HTMLButtonElement>('.magnetic-cta--hero')?.focus({ preventScroll: true });
  }, [showBootloader]);

  const prepareResources = () => {
    backgroundRef.current?.prepare();
    const audio = audioRef.current;
    if (!audio || !audioSource) return;
    // These calls stay in the gesture task; preparation is silent and does not grant entry.
    audio.muted = true;
    void audio.play().catch(() => setNeedsGesture(true));
  };

  const retryResources = () => {
    if (!isVideoReady || videoError) { setVideoError(''); setIsVideoReady(false); setVideoRetry((value) => value + 1); }
    if (!isStateLoaded || stateError) void fetchRadioState(channelIdRef.current);
    if (!isAudioReady || audioError) reloadStream();
  };

  const syncView = describeSync(syncSnapshot, isPlaying, audioBlocked);

  return (
    <MotionConfig reducedMotion="user"><SpatialMotionProvider><div className={`spatial-root theme-${theme}`}>
      <EveningBackground ref={backgroundRef} retry={videoRetry} showControls={!showBootloader && !authModalOpen}
        controlsHost={videoControlsHost}
        onReady={() => { setIsVideoReady(true); setVideoError(''); }} onError={setVideoError}
        onNeedsGesture={() => setNeedsGesture(true)} />
      {/* Hidden HTML5 Live Stream Audio Element (Anonymous stream URL, zero track metadata) */}
      <audio
        ref={audioRef}
        src={audioSource}
        preload="auto"
        crossOrigin="anonymous"
        onLoadedMetadata={handleAudioLoadedMetadata}
        onPlay={handleAudioPlay}
        onPause={handleAudioPause}
        onError={handleAudioError}
        onEnded={handleAudioEnded}
      />

      {/* Fullscreen Multi-Stage Boot Preloader */}
      {showBootloader && (
        <BootPreloader
          isStateLoaded={Boolean(audioSource)}
          isVideoReady={isVideoReady}
          errorText={videoError || bootStateError || audioError}
          needsGesture={needsGesture}
          onPrepare={prepareResources}
          onRetry={retryResources}
          isAudioReady={isAudioReady}
          onEnterEther={async (autoPlay) => {
            if (!audioSource || loadedStateChannelRef.current !== channelIdRef.current ||
                !isAudioReady || !isVideoReady || videoError || bootStateError || audioError) return false;
            const audio = audioRef.current;
            if (!autoPlay && audio) { audio.pause(); audio.muted = false; }
            enteredRef.current = true;
            bootVisibleRef.current = false;
            if (autoPlay && !await startPlayback()) {
              ++transportEpochRef.current;
              playIntentRef.current = false;
              radioDsp.setPlaybackIntent(false);
              if (audio) { audio.muted = true; audio.pause(); }
              enteredRef.current = false;
              bootVisibleRef.current = true;
              return false;
            }
            return true;
          }}
          onReveal={() => setBootRevealed(true)}
          onComplete={() => setShowBootloader(false)}
        />
      )}

      <div ref={contentRef} className="radio-content" data-boot-hidden={showBootloader && !bootRevealed ? true : undefined} inert={showBootloader || authModalOpen} aria-hidden={showBootloader || authModalOpen ? true : undefined}>
      {/* Floating Dynamic Glass Island Navigation Bar */}
      <AmbientHeader>
        <div className="floating-glass-island">
          {/* Brand Identity */}
          <div className="island-brand">
            <span className="island-brand__logo" aria-hidden="true">
              <MagneticMark><RadioMark size={34} animate /></MagneticMark>
            </span>
            <div className="island-brand__text">
              <StationWordmark />
              <span className="island-brand__tag">Музыка на вечер</span>
            </div>
          </div>

          {/* 3 Live Broadcast Channels */}
          <nav className="island-channels" aria-label="Каналы радиоэфира">
            {radioState.channels.length === 0 && <span className="island-channel-loading">{stateError ? 'Каналы недоступны' : 'Загружаем каналы…'}</span>}
            {radioState.channels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className={`island-channel-btn ${
                  channelId === ch.id ? 'is-active' : ''
                }`}
                onClick={() => selectChannel(ch.id)}
                aria-pressed={channelId === ch.id}
              >
                <LiveBeaconIcon size={14} />
                <span>{CHANNEL_COPY[ch.id]?.name || ch.name}</span>
                
              </button>
            ))}
          </nav>

          {/* 5 Glass Design Switcher + Showcase Links */}
          <div className="island-actions">
            <div ref={setVideoControlsHost} className="island-video-control" />
            <BackgroundMotionControl />
            <div className="island-links">
              <a href="#dsp-stage" className="island-link">Звук</a>
              <a href="#lounge-stage" className="island-link">Каналы</a>
              <button type="button" className="island-link" onClick={() => { setBootRevealed(false); setShowBootloader(true); }}>О радио</button>
            </div>
          </div>
        </div>
      </AmbientHeader>

      {/* Main Scroll-Choreographed Spatial Experience */}
      <main className="spatial-main">

        {/* SECTION 01: SPATIAL HERO & SOUNDCLOUD-PRO GLASS WAVEFORM */}
        <motion.section initial={{ opacity: 0, y: reducedMotion ? 0 : 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.05 }} transition={{ duration: 0.7 }}
          id="ether-stage"
          className="scroll-reveal-section is-inview hero-stage-section"
          aria-label="Прямой эфир и интерактивная аудиоволна"
        >
          <motion.div className="hero-editorial-grid" initial={{ opacity: 0, y: reducedMotion ? 0 : 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.25 }}>
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
              <h1 className="hero-display-title" style={{ fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif", fontWeight: 400, letterSpacing: '-0.055em' }}>
                ToniVecherRadio
              </h1>
              <p className="hero-lead-copy" style={{ fontFamily: "'Inter', sans-serif" }}>
                Выбирайте канал и слушайте вместе.
                Понравился момент — отметьте его на волне.
              </p>
              {stateError && <p className="auth-error-box" role="alert">{stateError} <button onClick={() => fetchRadioState(channelId)}>Повторить</button></p>}
              {audioError && <p className="auth-error-box" role="alert">{audioError} <button onClick={reloadStream}>Повторить</button></p>}
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
                <motion.button whileHover={{ scale: reducedMotion ? 1 : 1.03 }} whileTap={{ scale: reducedMotion ? 1 : 0.97 }}
                  type="button"
                  className={`magnetic-cta magnetic-cta--hero ${
                    isPlaying ? 'is-playing' : ''
                  }`}
                  onClick={togglePlay}
                  aria-label={isPlaying ? 'Пауза эфира' : 'Слушать радио'}
                >
                  <span className="magnetic-cta__halo" aria-hidden="true" />
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={isPlaying ? 'pause' : 'play'} className="transport-button-content" aria-hidden="true"
                      initial={{ opacity: 0, y: reducedMotion ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : -5 }}
                      transition={{ duration: reducedMotion ? 0 : 0.14 }}>
                      <span className="magnetic-cta__label">{isPlaying ? 'Пауза' : 'Слушать радио'}</span>
                      <span className="magnetic-cta__pod">{isPlaying ? <PauseSignalIcon size={18} /> : <PlaySignalIcon size={18} />}</span>
                    </motion.span>
                  </AnimatePresence>
                </motion.button>

                <div className="hero-secondary-controls">
                  <button
                    type="button"
                    className="glass-pill-btn"
                    onClick={handleResyncLive}
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
                      aria-valuenow={macros.masterGain}
                      className="glass-volume-ribbon"
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        updateVolumeFromClientX(e.currentTarget, e.clientX);
                      }}
                      onPointerMove={(e) => {
                        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                        updateVolumeFromClientX(e.currentTarget, e.clientX);
                      }}
                      onPointerUp={(e) => {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      }}
                      onPointerCancel={(e) => {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowRight') {
                          e.preventDefault();
                          handleMacroChange({
                            masterGain: Math.min(100, macros.masterGain + 5),
                          });
                        } else if (e.key === 'ArrowLeft') {
                          e.preventDefault();
                          handleMacroChange({
                            masterGain: Math.max(0, macros.masterGain - 5),
                          });
                        }
                      }}
                    >
                      <span
                        className="glass-volume-ribbon__fill"
                        style={{ width: `${macros.masterGain}%` }}
                      />
                      <span
                        className="glass-volume-ribbon__thumb"
                        style={{ left: `calc(${macros.masterGain}% - 6px)` }}
                      />
                    </div>
                    <span className="glass-volume-val">
                      {macros.masterGain}%
                    </span>
                  </div>
                </div>
              </div>
            </FloatPanel>

          </motion.div>

          {/* Double-Bezel Liquid Glass SoundCloud-Pro Waveform Stage */}
          <WaveformTimeline
            peaks={radioState.peaks}
            heatmap={radioState.heatmap}
            durationSec={radioState.broadcast.durationSec}
            positionSec={livePositionSec}
            moments={radioState.moments}
            isPlaying={isPlaying}
            onDropMoment={handleDropMoment}
            onLikeMoment={handleLikeMoment}
            renderReactionIcon={renderReactionIcon}
          />
        </motion.section>

        {/* SECTION 02: SCROLL-REVEALED 10-BAND SPATIAL DSP CONSOLE */}
        <motion.section initial={{ opacity: 0, y: reducedMotion ? 0 : 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.05 }} transition={{ duration: 0.7 }}
          id="dsp-stage"
          className="scroll-reveal-section dsp-stage-section"
          aria-label="Настройка звука"
        >
          <DspEqualizerConsole
            isPlaying={isPlaying}
            isBypassed={isDspBypassed}
            onChangeBypass={handleDspBypass}
            bands={bands}
            macros={macros}
            activePresetId={activePresetId}
            customPresets={customPresets}
            onSelectPreset={handleSelectPreset}
            onChangeBand={handleBandChange}
            onChangeMacro={handleMacroChange}
            onSaveCustomPreset={handleSaveCustomPreset}
            onResetFlat={handleResetFlat}
          />
        </motion.section>

        {/* SECTION 03: SCROLL-REVEALED SPLIT STUDIO — FREQUENCY ARCHITECTURE & GLASS CHAT */}
        <motion.section initial={{ opacity: 0, y: reducedMotion ? 0 : 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.05 }} transition={{ duration: 0.7 }}
          id="lounge-stage"
          className="scroll-reveal-section lounge-stage-section"
          aria-label="Выбор канала"
        >
          <div className="lounge-split-grid">
            {/* Left Column: Open Spatial Frequency Telemetry & Design Switcher Cards */}
            <FloatPanel className="lounge-telemetry-col" depth={1.4}>
              <div className="lounge-telemetry-header">
                <span className="section-eyebrow">
                  Выберите настроение
                </span>
                <h2 className="section-heading">
                  На вашей волне
                </h2>
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
                {radioState.channels.map((ch) => {
                  const isCurrent = channelId === ch.id;
                  return (
                    <div
                      key={ch.id}
                      role="radio"
                      tabIndex={0}
                      aria-checked={isCurrent}
                      className={`channel-lens-row ${
                        isCurrent ? 'is-active' : ''
                      }`}
                      onClick={() => selectChannel(ch.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectChannel(ch.id);
                        }
                      }}
                    >
                      <div className="channel-lens-row__left">
                        <span className="channel-lens-row__freq">
                          {String(radioState.channels.indexOf(ch) + 1).padStart(2, '0')}
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
                <div><strong>Слушайте без треклиста</strong><p>Названия треков скрыты. Понравился момент — оставьте отметку на волне.</p></div>
              </div>
            </FloatPanel>

            {/* Right Column: Airy Glass Live Ether Chat */}
            <LiveEtherChat
              messages={radioState.messages}
              listenersCount={radioState.listenersCount}
              session={session}
              activeSetCode={radioState.broadcast.code}
              currentPositionSec={livePositionSec}
              onSendMessage={handleSendMessage}
              onReactToMessage={handleReactToMessage}
              onOpenAuthModal={() => setAuthModalOpen(true)}
              renderReactionIcon={renderReactionIcon}
            />
          </div>
        </motion.section>
      </main>
      <footer className="radio-footer"><MagneticMark><RadioMark size={28} animate /></MagneticMark><span>ToniVecherRadio</span><span>Музыка на вечер</span></footer>

      {dockError && <p className="auth-error-box dock-action-error" role="alert">{dockError}</p>}
      {/* Persistent Floating Glass Mini-Player Dock on Scroll */}
      <aside
        className={`floating-mini-dock ${showMiniDock ? 'is-visible' : ''}`}
        aria-label="Плавающий мини-плеер эфира"
        inert={!showMiniDock}
        aria-hidden={!showMiniDock}
      >
        <div className="floating-mini-dock__left">
          <button
            type="button"
            className="mini-dock-play-btn"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Пауза эфира' : 'Слушать прямой эфир'}
          >
            {isPlaying ? (
              <PauseSignalIcon size={16} />
            ) : (
              <PlaySignalIcon size={16} />
            )}
          </button>
          <div className="mini-dock-meta">
            <strong>ToniVecherRadio</strong>
            <span>
              {CHANNEL_COPY[channelId]?.name || 'Эфир'} · {formatTimecode(livePositionSec)}
            </span>
          </div>
        </div>

        <div className="floating-mini-dock__right">
          <button
            type="button"
            className="glass-pill-btn"
            onClick={() => { setDockError(''); void handleDropMoment(Math.floor(livePositionSec), 'fire', '').catch((error) => setDockError(error instanceof Error ? error.message : 'Не удалось оставить отметку.')); }}
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

      </div>
      {/* PoW Shield Callsign Auth Modal */}
      <AuthShieldModal
        isOpen={authModalOpen}
        currentSession={session}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={(newSession) => {
          sessionRef.current = newSession;
          setSession(newSession);
          safeStorage.setItem('radiotv_session', JSON.stringify(newSession));
        }}
      />
    </div></SpatialMotionProvider></MotionConfig>
  );
};
