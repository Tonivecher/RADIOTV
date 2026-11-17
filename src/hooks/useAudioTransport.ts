import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { DspMacroState, radioDsp } from '../audio/dspEngine';
import { LiveClock, LivePhaseLock, SyncSnapshot } from '../audio/liveSync';
import { IDLE_SYNC } from '../constants/radio';

interface UseAudioTransportParams {
  channelId: string;
  channelIdRef: RefObject<string>;
  anchorChannelRef: RefObject<string>;
  currentSetIdRef: RefObject<string>;
  durationRef: RefObject<number>;
  liveClock: LiveClock;
  fetchInFlightRef: RefObject<boolean>;
  fetchRadioState: (channel: string) => Promise<void>;
  isStateLoaded: boolean;
  stateChannelId: string;
  broadcastSetId: string | number;
  bands: number[];
  macros: DspMacroState;
  isDspBypassed: boolean;
  enteredRef: RefObject<boolean>;
  bootVisibleRef: RefObject<boolean>;
}

export function useAudioTransport({
  channelId,
  channelIdRef,
  anchorChannelRef,
  currentSetIdRef,
  durationRef,
  liveClock,
  fetchInFlightRef,
  fetchRadioState,
  isStateLoaded,
  stateChannelId,
  broadcastSetId,
  bands,
  macros,
  isDspBypassed,
  enteredRef,
  bootVisibleRef,
}: UseAudioTransportParams) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [streamRevision, setStreamRevision] = useState(0);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [isAudioReady, setIsAudioReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [syncSnapshot, setSyncSnapshot] = useState<SyncSnapshot>(IDLE_SYNC);
  const [audioBlocked, setAudioBlocked] = useState<boolean>(false);

  const phaseLockRef = useRef<LivePhaseLock | null>(null);
  const playIntentRef = useRef<boolean>(false);
  const transportEpochRef = useRef<number>(0);
  const playInFlightRef = useRef<Promise<boolean> | null>(null);
  const loadingRef = useRef<boolean>(false);
  const audioMetaLoadedRef = useRef<boolean>(false);
  const resumeAfterLoadRef = useRef<boolean>(false);
  const audioLoadedSetRef = useRef<string | null>(null);
  const pauseTimerRef = useRef<number | null>(null);

  const dspStateRef = useRef({ bands, macros, isDspBypassed });
  dspStateRef.current = { bands, macros, isDspBypassed };

  const startPlaybackRef = useRef<() => Promise<boolean>>(async () => false);
  const reloadStreamRef = useRef<() => void>(() => {});
  const maybeResumeAfterLoadRef = useRef<() => void>(() => {});

  const audioSource =
    isStateLoaded && stateChannelId === channelId && broadcastSetId
      ? `/api/radio/stream/${channelId}?set=${encodeURIComponent(String(broadcastSetId))}&load=${streamRevision}`
      : undefined;

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
  }, [liveClock, durationRef]);

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current !== null) {
        window.clearTimeout(pauseTimerRef.current);
      }
    };
  }, []);

  const syncAudioToLiveClock = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    // No server fix yet, or the fix belongs to another channel: seeking now would land in the wrong place.
    if (!liveClock.hasEstimate() || anchorChannelRef.current !== channelIdRef.current) {
      return;
    }
    const mediaDuration =
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
    const limit = Math.min(durationRef.current, mediaDuration) - 0.5;
    try {
      audio.currentTime = Math.max(0, Math.min(liveClock.getTargetSec(), limit));
    } catch {
      // metadata not ready; the phase lock will correct once playback starts
    }
  }, [liveClock, anchorChannelRef, channelIdRef, durationRef]);

  const startPlayback = useCallback((): Promise<boolean> => {
    const audio = audioRef.current;
    if (!audio || !enteredRef.current) {
      return Promise.resolve(false);
    }
    // A gesture handler and a button onClick can both fire for one tap: share one attempt.
    if (playInFlightRef.current) {
      return playInFlightRef.current;
    }

    const run = async (): Promise<boolean> => {
      if (pauseTimerRef.current !== null) {
        window.clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
      const epoch = ++transportEpochRef.current;
      playIntentRef.current = true;
      radioDsp.setPlaybackIntent(true);
      if (!radioDsp.initAndAttach(audio)) {
        playIntentRef.current = false;
        radioDsp.setPlaybackIntent(false);
        setAudioBlocked(true);
        return false;
      }

      const dsp = dspStateRef.current;
      radioDsp.setBands(dsp.bands);
      radioDsp.setMacros(dsp.macros);
      radioDsp.setBypass(dsp.isDspBypassed);

      // iOS: resume() and play() must both be issued synchronously inside the gesture task.
      const contextReady = radioDsp.resume(true);
      audio.muted = false;
      syncAudioToLiveClock();

      let playTimeout: number | undefined;
      try {
        const played = audio.play();
        await Promise.race([
          played,
          new Promise<never>((_, reject) => {
            playTimeout = window.setTimeout(() => reject(new Error('Playback timed out')), 8000);
          }),
        ]);
      } catch (err) {
        if (epoch !== transportEpochRef.current) {
          return false;
        }
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
      } finally {
        window.clearTimeout(playTimeout);
      }

      const running = await contextReady;
      if (epoch !== transportEpochRef.current || !playIntentRef.current || audio.paused) {
        return false;
      }
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
      if (playInFlightRef.current === attempt) {
        playInFlightRef.current = null;
      }
    });
    playInFlightRef.current = attempt;
    return attempt;
  }, [enteredRef, syncAudioToLiveClock]);

  const pausePlayback = useCallback(() => {
    const audio = audioRef.current;
    const epoch = ++transportEpochRef.current;
    playIntentRef.current = false;
    resumeAfterLoadRef.current = false;
    radioDsp.setPlaybackIntent(false);
    setIsPlaying(false);
    setAudioBlocked(false);
    phaseLockRef.current?.reset();
    if (!audio) {
      return;
    }

    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }

    // Background tabs get throttled timers (and may be frozen right after a lock-screen tap): pause at once.
    if (document.visibilityState === 'hidden') {
      audio.pause();
      return;
    }
    // 15 ms fade-out first so the pause does not click; a new play() in between cancels the pause.
    radioDsp.fadeOut(15);
    pauseTimerRef.current = window.setTimeout(() => {
      pauseTimerRef.current = null;
      if (transportEpochRef.current === epoch) {
        audio.pause();
      }
    }, 20);
  }, []);

  const reloadStream = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
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
    if (!resumeAfterLoadRef.current || !audioMetaLoadedRef.current) {
      return;
    }
    if (anchorChannelRef.current !== channelIdRef.current) {
      // wait for the new channel's state
      return;
    }
    resumeAfterLoadRef.current = false;
    loadingRef.current = false;
    void startPlaybackRef.current();
  }, [anchorChannelRef, channelIdRef]);

  const prepareForChannelSwitch = useCallback(() => {
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
  }, []);

  const onBroadcastSynced = useCallback((setKey: string) => {
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
  }, []);

  startPlaybackRef.current = startPlayback;
  reloadStreamRef.current = reloadStream;
  maybeResumeAfterLoadRef.current = maybeResumeAfterLoad;

  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      pausePlayback();
    } else {
      await startPlayback();
    }
  }, [isPlaying, pausePlayback, startPlayback]);

  const handleResyncLive = useCallback(async () => {
    await fetchRadioState(channelIdRef.current);
    const audio = audioRef.current;
    if (audio && playIntentRef.current && !audio.paused) {
      await phaseLockRef.current?.forceResync();
    } else {
      await startPlayback();
    }
  }, [channelIdRef, fetchRadioState, startPlayback]);

  const forceResync = useCallback(() => {
    void phaseLockRef.current?.forceResync();
  }, []);

  const prepareAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioSource) {
      return;
    }
    // These calls stay in the gesture task; preparation is silent and does not grant entry.
    audio.muted = true;
    void audio.play().catch(() => setNeedsGesture(true));
  }, [audioSource]);

  const rollbackBootAudio = useCallback(() => {
    const audio = audioRef.current;
    ++transportEpochRef.current;
    playIntentRef.current = false;
    radioDsp.setPlaybackIntent(false);
    if (audio) {
      audio.muted = true;
      audio.pause();
    }
  }, []);

  const handleAudioLoadedMetadata = useCallback(() => {
    audioMetaLoadedRef.current = true;
    audioLoadedSetRef.current =
      anchorChannelRef.current === channelIdRef.current
        ? currentSetIdRef.current || null
        : null;
    if (resumeAfterLoadRef.current) {
      maybeResumeAfterLoadRef.current();
      return;
    }
    loadingRef.current = false;
    syncAudioToLiveClock();
  }, [anchorChannelRef, channelIdRef, currentSetIdRef, syncAudioToLiveClock]);

  const handleAudioPlay = useCallback(() => {
    if (!enteredRef.current || (bootVisibleRef.current && !playIntentRef.current)) {
      return;
    }
    if (playIntentRef.current) {
      // started by us
      return;
    }
    // Resumed by the system (headset button, interruption ended). Follow it, and ramp the bus back in
    // because our own pause leaves the fade stage at silence.
    playIntentRef.current = true;
    radioDsp.setPlaybackIntent(true);
    const epoch = transportEpochRef.current;
    void radioDsp.resume(true).then((running) => {
      if (epoch !== transportEpochRef.current || !playIntentRef.current || audioRef.current?.paused) {
        return;
      }
      setIsPlaying(running);
      setAudioBlocked(!running);
    });
  }, [bootVisibleRef, enteredRef]);

  const handleAudioPause = useCallback(() => {
    if (loadingRef.current || audioRef.current?.ended || !playIntentRef.current) {
      return;
    }
    // A pause nobody asked for (phone call, headset unplugged, OS decision): reflect it honestly.
    ++transportEpochRef.current;
    playInFlightRef.current = null;
    resumeAfterLoadRef.current = false;
    playIntentRef.current = false;
    radioDsp.setPlaybackIntent(false);
    setIsPlaying(false);
  }, []);

  const handleAudioError = useCallback(() => {
    setIsAudioReady(false);
    setAudioError('Не удалось загрузить звук. Проверьте соединение и повторите.');
    loadingRef.current = false;
    resumeAfterLoadRef.current = false;
    if (playIntentRef.current) {
      playIntentRef.current = false;
      radioDsp.setPlaybackIntent(false);
      setIsPlaying(false);
    }
  }, []);

  const handleAudioEnded = useCallback(() => {
    // The set finished; the server now serves the next one from the same URL, so the element must reload.
    resumeAfterLoadRef.current = playIntentRef.current;
    void fetchRadioState(channelIdRef.current).then(() => {
      if (audioMetaLoadedRef.current) {
        reloadStreamRef.current();
      }
    });
  }, [channelIdRef, fetchRadioState]);

  // iOS / Android audio-policy resilience
  useEffect(() => {
    return radioDsp.subscribe((event) => {
      setAudioBlocked(event === 'blocked');
      if (event === 'blocked') {
        setIsPlaying(false);
      } else if (
        enteredRef.current &&
        playIntentRef.current &&
        audioRef.current &&
        !audioRef.current.paused
      ) {
        setIsPlaying(true);
      }
    });
  }, [enteredRef]);

  // Keep the audio session in playback mode; stop timer-driven corrections while hidden.
  useEffect(() => {
    const keepAlive = () => {
      phaseLockRef.current?.checkNow();
      if (playIntentRef.current) {
        void radioDsp.resume(false);
      }
    };
    const recover = async () => {
      const audio = audioRef.current;
      if (!audio || !playIntentRef.current) {
        return;
      }
      // SSE ticks may have been missed in the background: re-anchor the live clock.
      if (!fetchInFlightRef.current) {
        void fetchRadioState(channelIdRef.current);
      }
      if (audio.paused && !audio.ended && !loadingRef.current) {
        await startPlaybackRef.current();
      } else {
        const running = await radioDsp.resume(false);
        if (!playIntentRef.current) {
          return;
        }
        setAudioBlocked(!running);
        setIsPlaying(running && !audio.paused);
        phaseLockRef.current?.checkNow();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        keepAlive();
      } else {
        void recover();
      }
    };
    const onPageHide = () => keepAlive();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        // restored from the back/forward cache
        void recover();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [channelIdRef, fetchInFlightRef, fetchRadioState]);

  // Metadata is insufficient: seek to the actual broadcast point, then require decoded,
  // buffered data around that point. A stalled resource stays blocked until recovery.
  useEffect(() => {
    const audio = audioRef.current;
    setIsAudioReady(false);
    if (!audio || !audioSource) {
      return;
    }

    let active = true;
    let ready = false;
    let waitingSince = Date.now();
    let lastSeekAt = 0;
    let lastPrepareAt = 0;
    const expected = new URL(audioSource, window.location.href).href;

    const check = () => {
      if (!active) {
        return;
      }
      if (bootVisibleRef.current && document.hidden) {
        audio.pause();
        waitingSince = Date.now();
        return;
      }
      if (!ready && Date.now() - waitingSince > 20000) {
        setAudioError('Звук загружается слишком долго. Нажмите «Подготовить» или повторите загрузку.');
        setNeedsGesture(true);
      }
      if (audio.currentSrc !== expected || !audioMetaLoadedRef.current) {
        return;
      }

      const target = Math.max(0, Math.min(liveClock.getTargetSec(), audio.duration - 0.5));
      if (
        (bootVisibleRef.current || !ready) &&
        !audio.seeking &&
        Math.abs(audio.currentTime - target) > 1.2 &&
        Date.now() - lastSeekAt > 1200
      ) {
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
        if (
          audio.buffered.start(i) <= Math.max(0, point - 0.15) &&
          audio.buffered.end(i) >= Math.min(audio.duration - 0.1, point + reserve)
        ) {
          buffered = true;
        }
      }

      const next =
        !audio.error &&
        !audio.seeking &&
        audio.readyState >= 3 &&
        buffered &&
        (!(bootVisibleRef.current || !ready) || Math.abs(audio.currentTime - target) <= 1.2);

      if (next) {
        if (!ready) {
          ready = true;
          setIsAudioReady(true);
          setAudioError('');
          setNeedsGesture(false);
        }
        waitingSince = Date.now();
      } else {
        if (ready) {
          ready = false;
          setIsAudioReady(false);
        }
        // Some browsers stop paused preloading before the required reserve.
        // Keep preparation silent and moving with the live clock until entry.
        if (
          bootVisibleRef.current &&
          audio.paused &&
          !audio.seeking &&
          Date.now() - lastPrepareAt > 3000
        ) {
          lastPrepareAt = Date.now();
          audio.muted = true;
          void audio.play().catch(() => {
            if (active) {
              setNeedsGesture(true);
            }
          });
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

    return () => {
      active = false;
      window.clearInterval(interval);
      events.forEach((name) => audio.removeEventListener(name, check));
    };
  }, [audioSource, bootVisibleRef, liveClock]);

  return {
    audioRef,
    audioSource,
    needsGesture,
    setNeedsGesture,
    audioError,
    isAudioReady,
    isPlaying,
    syncSnapshot,
    audioBlocked,
    startPlayback,
    pausePlayback,
    reloadStream,
    prepareForChannelSwitch,
    onBroadcastSynced,
    togglePlay,
    handleResyncLive,
    forceResync,
    prepareAudio,
    rollbackBootAudio,
    handleAudioLoadedMetadata,
    handleAudioPlay,
    handleAudioPause,
    handleAudioError,
    handleAudioEnded,
  };
}
