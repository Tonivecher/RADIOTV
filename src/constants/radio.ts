import { SyncSnapshot } from '../audio/liveSync';
import { RadioIconName } from '../components/icons/RadioIcons';
import { RadioStatePayload, ReactionKind } from '../types/radio';

export const REACTION_TO_ICON: Record<ReactionKind, RadioIconName> = {
  fire: 'react-fire',
  hypnotic: 'react-hypnotic',
  subbass: 'react-subbass',
  goosebumps: 'react-goosebumps',
  acid: 'react-acid',
  heart: 'react-heart',
};

/** Order used by the lock-screen previous / next buttons. */
export const CHANNEL_ORDER = ['ch-main', 'ch-deep', 'ch-afterglow'] as const;

export const IDLE_SYNC: SyncSnapshot = {
  state: 'idle',
  driftSec: 0,
  playbackRate: 1,
};

export const EMPTY_STATE: RadioStatePayload = {
  channelId: 'ch-main',
  channels: [],
  broadcast: {
    setId: '',
    code: '',
    frequency: '',
    sonicTag: '',
    durationSec: 0,
    positionSec: 0,
    startedAtMs: Date.now(),
    nextCode: '',
    startsInSec: 0,
    streamUrl: '',
  },
  peaks: [],
  heatmap: [],
  moments: [],
  messages: [],
  listenersCount: 0,
  serverTimeMs: Date.now(),
};

export const CHANNEL_COPY: Record<string, { name: string; description: string }> = {
  'ch-main': {
    name: 'Основной',
    description: 'Deep-tech и tech. Ровный ритм городского вечера.',
  },
  'ch-deep': {
    name: 'Deep',
    description: 'Глубже в звук. Deep и мягкий бас.',
  },
  'ch-afterglow': {
    name: 'DeepTech',
    description: 'Медленнее, теплее. Глубокий ночной ритм.',
  },
};
