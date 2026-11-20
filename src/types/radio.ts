export type ReactionKind =
  | 'fire'
  | 'hypnotic'
  | 'subbass'
  | 'goosebumps'
  | 'acid'
  | 'heart';

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

export interface StreamEdgeCandidate {
  id: string;
  region: string;
  url: string;
}

interface BroadcastSlot {
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
  streamUrls?: StreamEdgeCandidate[];
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
