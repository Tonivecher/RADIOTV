import { SyncSnapshot } from '../audio/liveSync';
import { EMPTY_STATE } from '../constants/radio';
import {
  ChatMessageItem,
  RadioChannelInfo,
  RadioStatePayload,
  ReactionKind,
  WaveformMoment,
} from '../types/radio';

const MEDIA_ARTWORK_SIZES = [96, 128, 256, 512] as const;
const INVALID_PAYLOAD_MESSAGE = 'Сервер вернул некорректные данные эфира. Повторите попытку.';

export interface SyncView {
  label: string;
  announce: string;
  tone: 'idle' | 'ok' | 'drift' | 'resync' | 'blocked';
}

interface ParsedRadioState {
  state: RadioStatePayload;
  socialRevision: number;
  serverNow: number;
}

export function buildMediaArtwork(): MediaImage[] {
  return MEDIA_ARTWORK_SIZES.map((size) => ({
    src: new URL(`/brand/icon-${size}.png`, window.location.origin).href,
    sizes: `${size}x${size}`,
    type: 'image/png',
  }));
}

export function describeSync(
  snap: SyncSnapshot,
  isPlaying: boolean,
  audioBlocked: boolean
): SyncView {
  if (audioBlocked) {
    return {
      label: 'Нажмите «Слушать радио»',
      announce: 'Для запуска звука нажмите «Слушать радио»',
      tone: 'blocked',
    };
  }
  if (!isPlaying) {
    return {
      label: 'На паузе',
      announce: 'Ожидание',
      tone: 'idle',
    };
  }
  switch (snap.state) {
    case 'in-sync':
      return {
        label: 'В прямом эфире',
        announce: 'Синхронизация с эфиром',
        tone: 'ok',
      };
    case 'compensating':
      return {
        label: 'Подстраиваем эфир',
        announce: 'Подстраиваем воспроизведение',
        tone: 'drift',
      };
    case 'resync':
      return {
        label: 'Возвращаемся в эфир',
        announce: 'Возврат в живой эфир',
        tone: 'resync',
      };
    default:
      return {
        label: 'Подключаемся',
        announce: 'Подключаемся к эфиру',
        tone: 'idle',
      };
  }
}

function mergeByRevision<T extends { id: number; revision?: number }>(
  snapshot: T[],
  current: T[],
  snapshotRevision: number
): T[] {
  const rows = new Map(snapshot.map((row) => [row.id, row]));
  for (const row of current) {
    if ((row.revision || 0) > snapshotRevision) {
      rows.set(row.id, row);
    }
  }
  return [...rows.values()];
}

function normalizeMoments(
  items: unknown[],
  socialRevision: number,
  fallbackSetId: string | number
): WaveformMoment[] {
  return items.map((item, idx) => {
    const m = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      revision: socialRevision,
      id: Number(m.id ?? idx + 1),
      setId: (m.setId ?? m.set_id ?? fallbackSetId) as string | number,
      callsign: String(m.callsign ?? 'Гость'),
      avatarColor: String(m.avatarColor ?? m.avatar_color ?? '#38BDF8'),
      timestampSec: Number(m.timestampSec ?? m.timestamp_sec ?? 0),
      reactionType: (m.reactionType ?? m.reaction_type ?? 'fire') as ReactionKind,
      comment: String(m.comment ?? ''),
      likesCount: Number(m.likesCount ?? m.likes_count ?? 0),
      createdAt: String(m.createdAt ?? m.created_at ?? ''),
    };
  });
}

function normalizeMessages(
  items: unknown[],
  socialRevision: number,
  targetChannel: string,
  fallbackCode: string,
  fallbackPositionSec: number
): ChatMessageItem[] {
  return items.map((item, idx) => {
    const msg = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      revision: socialRevision,
      id: Number(msg.id ?? idx + 1),
      channelId: String(msg.channelId ?? msg.channel_id ?? targetChannel),
      callsign: String(msg.callsign ?? 'Гость'),
      avatarColor: String(msg.avatarColor ?? msg.avatar_color ?? '#38BDF8'),
      text: String(msg.text ?? ''),
      setCode: String(msg.setCode ?? msg.set_code ?? fallbackCode),
      setTimestampSec: Number(
        msg.setTimestampSec ?? msg.set_timestamp_sec ?? fallbackPositionSec
      ),
      reactions: (msg.reactions ?? {}) as Partial<Record<ReactionKind, number>>,
      createdAt: String(msg.createdAt ?? msg.created_at ?? ''),
    };
  });
}

export function parseRadioStateResponse(
  raw: unknown,
  targetChannel: string,
  receivedAt: number
): ParsedRadioState {
  if (!raw || typeof raw !== 'object') {
    throw new Error(INVALID_PAYLOAD_MESSAGE);
  }
  const record = raw as Record<string, unknown>;
  const serverNow = Number(record.serverTimeMs || record.serverTime || receivedAt);
  const b = (
    record.broadcast && typeof record.broadcast === 'object' ? record.broadcast : {}
  ) as Record<string, unknown>;

  if (b.available === false) {
    throw new Error('Эфир пока недоступен. Попробуйте ещё раз позже.');
  }

  const hasValidShape =
    record.ok === true &&
    Boolean(b.setId) &&
    typeof b.durationSec === 'number' &&
    Number.isFinite(b.durationSec) &&
    b.durationSec > 0 &&
    typeof b.positionSec === 'number' &&
    Number.isFinite(b.positionSec) &&
    b.positionSec >= 0 &&
    b.positionSec <= b.durationSec &&
    typeof b.streamUrl === 'string' &&
    b.streamUrl.startsWith('/api/radio/stream/') &&
    Array.isArray(record.channels) &&
    record.channels.some((c: unknown) => (c as { id?: string } | null)?.id === targetChannel);

  if (!hasValidShape) {
    throw new Error(INVALID_PAYLOAD_MESSAGE);
  }

  const durationSec = Number(b.durationSec ?? b.duration_sec ?? 0);
  const positionSec = Number(b.positionSec ?? b.position_sec ?? 0);
  const setId = (b.setId ?? b.set_id ?? 1) as string | number;
  const socialRevision = Number(record.socialRevision || 0);
  const code = String(b.code || '');

  const rawMoments = Array.isArray(record.moments)
    ? record.moments
    : Array.isArray(b.moments)
      ? b.moments
      : [];
  const rawMessages = Array.isArray(record.messages) ? record.messages : [];
  const channels =
    Array.isArray(record.channels) && record.channels.length > 0
      ? (record.channels as RadioChannelInfo[])
      : EMPTY_STATE.channels;

  const state: RadioStatePayload = {
    channelId: targetChannel,
    channels,
    broadcast: {
      setId,
      code,
      frequency: String(b.frequency || ''),
      sonicTag: String(b.sonicTag || b.sonic_tag || ''),
      durationSec,
      positionSec,
      startedAtMs: Number(b.startedAtMs) || Date.now() - Math.floor(positionSec * 1000),
      nextCode: String(b.nextCode ?? b.next_code ?? ''),
      startsInSec: Number(
        b.startsInSec ?? b.starts_in_sec ?? Math.max(10, durationSec - positionSec)
      ),
      streamUrl: String(b.streamUrl ?? ''),
    },
    peaks: Array.isArray(record.peaks)
      ? (record.peaks as number[])
      : Array.isArray(b.peaks)
        ? (b.peaks as number[])
        : [],
    heatmap: Array.isArray(record.heatmap)
      ? (record.heatmap as number[])
      : Array.isArray(b.heatmap)
        ? (b.heatmap as number[])
        : [],
    moments: normalizeMoments(rawMoments, socialRevision, setId),
    messages: normalizeMessages(rawMessages, socialRevision, targetChannel, code, positionSec),
    listenersCount: Number(record.listenersCount ?? record.listeners_count ?? 0),
    serverTimeMs: serverNow,
  };

  return { state, socialRevision, serverNow };
}

export function mergeRadioStateSnapshot(
  prev: RadioStatePayload,
  nextState: RadioStatePayload,
  socialRevision: number
): RadioStatePayload {
  const setId = nextState.broadcast.setId;
  const hasNewerMoments = prev.moments.some(
    (m) => String(m.setId) === String(setId) && (m.revision || 0) > socialRevision
  );

  return {
    ...nextState,
    heatmap: hasNewerMoments ? prev.heatmap : nextState.heatmap,
    messages: mergeByRevision(nextState.messages, prev.messages, socialRevision)
      .sort((a, b) => a.id - b.id)
      .slice(-50),
    moments: mergeByRevision(
      nextState.moments,
      prev.moments.filter((m) => String(m.setId) === String(setId)),
      socialRevision
    ).sort((a, b) => a.timestampSec - b.timestampSec || a.id - b.id),
  };
}

export function applyMomentToRadioState(
  prev: RadioStatePayload,
  data: { moment: WaveformMoment; heatmap?: number[] }
): RadioStatePayload {
  const moment = data.moment;
  if (!moment || !Number.isSafeInteger(moment.id)) {
    return prev;
  }
  if (String(moment.setId) !== String(prev.broadcast.setId)) {
    return prev;
  }
  const existing = prev.moments.find((item) => item.id === moment.id);
  if ((existing?.revision || 0) > (moment.revision || 0)) {
    return prev;
  }
  const updated: WaveformMoment = {
    ...moment,
    likesCount: Math.max(moment.likesCount, existing?.likesCount || 0),
  };
  const moments = [...prev.moments.filter((item) => item.id !== moment.id), updated].sort(
    (a, b) => a.timestampSec - b.timestampSec || a.id - b.id
  );
  return {
    ...prev,
    moments,
    heatmap: data.heatmap || prev.heatmap,
  };
}

export function applyMessageToRadioState(
  prev: RadioStatePayload,
  message: ChatMessageItem
): RadioStatePayload {
  if (!message || !Number.isSafeInteger(message.id)) {
    return prev;
  }
  const existing = prev.messages.find((item) => item.id === message.id);
  if ((existing?.revision || 0) > (message.revision || 0)) {
    return prev;
  }
  const messages = [...prev.messages.filter((item) => item.id !== message.id), message]
    .sort((a, b) => a.id - b.id)
    .slice(-50);
  return {
    ...prev,
    messages,
  };
}
