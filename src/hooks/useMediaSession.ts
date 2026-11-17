import { RefObject, useEffect, useRef } from 'react';
import { LiveClock } from '../audio/liveSync';
import { CHANNEL_COPY, CHANNEL_ORDER } from '../constants/radio';
import { RadioStatePayload } from '../types/radio';
import { buildMediaArtwork } from '../utils/radioState';

interface UseMediaSessionParams {
  channelId: string;
  channelIdRef: RefObject<string>;
  radioState: RadioStatePayload;
  isPlaying: boolean;
  livePositionSec: number;
  liveClock: LiveClock;
  enteredRef: RefObject<boolean>;
  onPlay: () => void;
  onPause: () => void;
  onSelectChannel: (channelId: string) => void;
  onForceResync: () => void;
}

export function useMediaSession({
  channelId,
  channelIdRef,
  radioState,
  isPlaying,
  livePositionSec,
  liveClock,
  enteredRef,
  onPlay,
  onPause,
  onSelectChannel,
  onForceResync,
}: UseMediaSessionParams): void {
  const mediaHandlersRef = useRef({
    play: () => {},
    pause: () => {},
    step: (_delta: number) => {},
    resync: () => {},
  });

  mediaHandlersRef.current = {
    play: onPlay,
    pause: onPause,
    step: (delta: number) => {
      const idx = Math.max(0, CHANNEL_ORDER.indexOf(channelIdRef.current as (typeof CHANNEL_ORDER)[number]));
      onSelectChannel(CHANNEL_ORDER[(idx + delta + CHANNEL_ORDER.length) % CHANNEL_ORDER.length]);
    },
    // It is a live stream: any scrub on the lock screen simply means "take me back to the live point".
    resync: onForceResync,
  };

  useEffect(() => {
    if (!('mediaSession' in navigator)) {
      return;
    }
    const mediaSession = navigator.mediaSession;
    const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        mediaSession.setActionHandler(action, handler);
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
      const boundActions: MediaSessionAction[] = [
        'play',
        'pause',
        'stop',
        'previoustrack',
        'nexttrack',
        'seekto',
      ];
      boundActions.forEach((action) => bind(action, null));
    };
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
      return;
    }
    // Wait until the state belongs to the channel we are tuned to, otherwise the lock screen flashes old data.
    if (radioState.channelId !== channelId) {
      return;
    }
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
    if (!('mediaSession' in navigator)) {
      return;
    }
    navigator.mediaSession.playbackState = isPlaying
      ? 'playing'
      : enteredRef.current
        ? 'paused'
        : 'none';
  }, [isPlaying, enteredRef]);

  const positionStateBucket = Math.floor(livePositionSec / 5);
  useEffect(() => {
    if (!('mediaSession' in navigator) || !liveClock.hasEstimate()) {
      return;
    }
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
}
