export type ReactionKind =
  | 'fire'
  | 'hypnotic'
  | 'subbass'
  | 'goosebumps'
  | 'acid'
  | 'heart';

export type ThemeId =
  | 'dusk'
  | 'graphite'
  | 'midnight'
  | 'cloud';

export interface ThemeMeta {
  id: ThemeId;
  code: string;
  name: string;
  shortName: string;
  subtitle: string;
  mode: 'dark' | 'light';
  accentHex: string;
  bgHex: string;
}

export const RADIO_THEMES: ThemeMeta[] = [
  { id: 'dusk', code: 'Вечер', name: 'Вечер', shortName: 'Вечер', subtitle: 'Тёплый свет', mode: 'dark', accentHex: '#e7bb94', bgHex: '#1b1a17' },
  { id: 'graphite', code: 'Графит', name: 'Графит', shortName: 'Графит', subtitle: 'Спокойные серые тона', mode: 'dark', accentHex: '#bac8ba', bgHex: '#202321' },
  { id: 'midnight', code: 'Ночь', name: 'Ночь', shortName: 'Ночь', subtitle: 'Глубокие синие тона', mode: 'dark', accentHex: '#b4c3df', bgHex: '#151c2b' },
  { id: 'cloud', code: 'Облако', name: 'Облако', shortName: 'Облако', subtitle: 'Светлая тема', mode: 'light', accentHex: '#876444', bgHex: '#efede6' },
];

export const REACTION_CATALOG: Array<{
  kind: ReactionKind;
  label: string;
  shortLabel: string;
  color: string;
}> = [
  { kind: 'fire', label: 'Огонь', shortLabel: 'Огонь', color: '#F97316' },
  { kind: 'hypnotic', label: 'Гипноз', shortLabel: 'Гипноз', color: '#38BDF8' },
  { kind: 'subbass', label: 'Бас', shortLabel: 'Бас', color: '#10B981' },
  { kind: 'goosebumps', label: 'Мурашки', shortLabel: 'Мурашки', color: '#C084FC' },
  { kind: 'acid', label: 'Эйсид', shortLabel: 'Эйсид', color: '#84CC16' },
  { kind: 'heart', label: 'Нравится', shortLabel: 'Нравится', color: '#F43F5E' },
];

export interface RadioChannelInfo {
  id: string;
  name: string;
  frequency: string;
  description: string;
  activeCode?: string;
}

export interface WaveformMoment {
  revision?: number;
  id: number;
  setId: string | number;
  callsign: string;
  avatarColor: string;
  timestampSec: number;
  reactionType: ReactionKind;
  comment: string;
  likesCount: number;
  createdAt: string | number;
}

export interface ChatMessageItem {
  revision?: number;
  id: number;
  channelId: string;
  callsign: string;
  avatarColor: string;
  text: string;
  setCode: string;
  setTimestampSec: number;
  reactions: Partial<Record<ReactionKind, number>>;
  createdAt: string | number;
}

export interface BroadcastSlot {
  setId: string | number;
  code: string;
  frequency: string;
  sonicTag: string;
  durationSec: number;
  positionSec: number;
  startedAtMs: number;
  nextCode: string;
  startsInSec: number;
  streamUrl: string;
}

export interface RadioStatePayload {
  channelId: string;
  channels: RadioChannelInfo[];
  broadcast: BroadcastSlot;
  peaks: number[];
  heatmap: number[];
  moments: WaveformMoment[];
  messages: ChatMessageItem[];
  listenersCount: number;
  serverTimeMs?: number;
  serverTime?: number;
}

export interface UserSession {
  id: string | number;
  callsign: string;
  avatarColor: string;
  token: string;
  powVerified: boolean;
}
