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

type TransportMode = 'direct' | 'dsp';

function gainToLinear(masterGain: number): number {
  return Math.max(0, Math.min(1, Math.pow(Math.max(0, Math.min(100, masterGain)) / 100, 1.6)));
}

function waitForMetadata(audio: HTMLAudioElement, timeoutMs = 4500): Promise<boolean> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', onReady);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('error', onFail);
      resolve(ok);
    };
    const onReady = () => finish(true);
    const onFail = () => finish(false);
    const timer = window.setTimeout(() => finish(audio.readyState >= 1), timeoutMs);
    audio.addEventListener('loadedmetadata', onReady, { once: true });
    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('error', onFail, { once: true });
  });
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
  // Primary clean native <audio> element: NEVER bound to createMediaElementSource so iOS AVPlayer
  // keeps Lock Screen & background playback alive reliably.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Dedicated DSP <audio> element: only attached to Web Audio AudioContext when DSP is enabled
  // and the page is visible in the foreground.
  const dspAudioRef = useRef<HTMLAudioElement | null>(null);

  const [streamRevision, setStreamRevision] = useState(0);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [isAudioReady, setIsAudioReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [syncSnapshot, setSyncSnapshot] = useState<SyncSnapshot>(IDLE_SYNC);
  const [audioBlocked, setAudioBlocked] = useState<boolean>(false);
  const [dspMediaArmed, setDspMediaArmed] = useState<boolean>(false);

  const activeModeRef = useRef<TransportMode>('direct');
  const handingOffRef = useRef<boolean>(false);
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
  const handoffToDirectRef = useRef<() => void>(() => {});
  const handoffToDspRef = useRef<() => Promise<void>>(async () => {});

  const audioSource =
    isStateLoaded && stateChannelId === channelId && broadcastSetId
      ? `/api/radio/stream/${channelId}?set=${encodeURIComponent(String(broadcastSetId))}&load=${streamRevision}`
      : undefined;

  const dspAudioSource = !isDspBypassed || dspMediaArmed ? audioSource : undefined;

  const getActiveAudio = useCallback((): HTMLAudioElement | null => {
    if (activeModeRef.current === 'dsp' && dspAudioRef.current) {
      return dspAudioRef.current;
    }
    return audioRef.current;
  }, []);

  // Configure iOS AudioSession playback category as early as possible.
  useEffect(() => {
    radioDsp.requestPlaybackAudioSession();
  }, []);

  // Sync direct <audio> volume whenever masterGain changes.
  useEffect(() => {
    const direct = audioRef.current;
    if (direct) {
      direct.volume = gainToLinear(macros.masterGain);
    }
  }, [macros.masterGain]);

  useEffect(() => {
    const lock = new LivePhaseLock({
      getAudio: () => getActiveAudio(),
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
  }, [liveClock, durationRef, getActiveAudio]);

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current !== null) {
        window.clearTimeout(pauseTimerRef.current);
      }
    };
  }, []);

  const syncElementToLiveClock = useCallback(
    (audio: HTMLAudioElement | null) => {
      if (!audio) return;
      if (!liveClock.hasEstimate() || anchorChannelRef.current !== channelIdRef.current) {
        return;
      }
      const mediaDuration =
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
      const limit = Math.min(durationRef.current, mediaDuration) - 0.5;
      try {
        audio.currentTime = Math.max(0, Math.min(liveClock.getTargetSec(), limit));
      } catch {
        // metadata not ready; phase lock will align once playing
      }
    },
    [liveClock, anchorChannelRef, channelIdRef, durationRef]
  );

  const syncAudioToLiveClock = useCallback(() => {
    syncElementToLiveClock(getActiveAudio());
  }, [getActiveAudio, syncElementToLiveClock]);

  const startPlayback = useCallback((): Promise<boolean> => {
    const direct = audioRef.current;
    if (!direct || !enteredRef.current) {
      return Promise.resolve(false);
    }
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
      radioDsp.requestPlaybackAudioSession();

      const dsp = dspStateRef.current;
      const wantDsp =
        !dsp.isDspBypassed &&
        document.visibilityState !== 'hidden' &&
        Boolean(dspAudioRef.current) &&
        Boolean(audioSource);

      const dspAudio = dspAudioRef.current;
      let mode: TransportMode = wantDsp ? 'dsp' : 'direct';
      let targetAudio: HTMLAudioElement = direct;
      let contextReady: Promise<boolean> = Promise.resolve(true);

      if (mode === 'dsp' && dspAudio) {
        setDspMediaArmed(true);
        if (!dspAudio.src && audioSource) {
          dspAudio.src = audioSource;
        }
        radioDsp.setPlaybackIntent(true);
        if (radioDsp.initAndAttach(dspAudio)) {
          radioDsp.setBands(dsp.bands);
          radioDsp.setMacros(dsp.macros);
          radioDsp.setBypass(false);
          contextReady = radioDsp.resume(true);
          targetAudio = dspAudio;
          dspAudio.muted = false;
          dspAudio.volume = 1;
        } else {
          // Fallback to clean native <audio> if Web Audio graph is unavailable.
          mode = 'direct';
          targetAudio = direct;
          radioDsp.setPlaybackIntent(false);
        }
      } else {
        radioDsp.setPlaybackIntent(false);
      }

      if (mode === 'direct') {
        direct.muted = false;
        direct.volume = gainToLinear(dsp.macros.masterGain);
        if (dspAudio && !dspAudio.paused) {
          handingOffRef.current = true;
          dspAudio.pause();
          handingOffRef.current = false;
        }
      } else {
        // Keep clean direct <audio> paused while DSP plays in foreground.
        if (!direct.paused) {
          handingOffRef.current = true;
          direct.pause();
          handingOffRef.current = false;
        }
      }

      activeModeRef.current = mode;
      syncElementToLiveClock(targetAudio);

      let playTimeout: number | undefined;
      try {
        const played = targetAudio.play();
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
          return false;
        }
        if (name === 'NotAllowedError') {
          setIsPlaying(false);
          setAudioBlocked(true);
          return false;
        }
        // If DSP element failed to start, fall back cleanly to direct native element.
        if (mode === 'dsp' && direct) {
          activeModeRef.current = 'direct';
          radioDsp.setPlaybackIntent(false);
          direct.muted = false;
          direct.volume = gainToLinear(dsp.macros.masterGain);
          syncElementToLiveClock(direct);
          try {
            await direct.play();
            loadingRef.current = false;
            setIsPlaying(true);
            setAudioBlocked(false);
            return true;
          } catch {
            // fall through to failure state
          }
        }
        playIntentRef.current = false;
        radioDsp.setPlaybackIntent(false);
        setIsPlaying(false);
        targetAudio.pause();
        return false;
      } finally {
        window.clearTimeout(playTimeout);
      }

      if (mode === 'dsp') {
        const running = await contextReady;
        if (epoch !== transportEpochRef.current || !playIntentRef.current || targetAudio.paused) {
          return false;
        }
        if (!running) {
          // If AudioContext couldn't unlock, seamlessly fall back to native <audio> so audio still works!
          if (document.visibilityState === 'hidden') {
            handoffToDirectRef.current();
            return true;
          }
          setIsPlaying(false);
          setAudioBlocked(true);
          return false;
        }
      } else if (epoch !== transportEpochRef.current || !playIntentRef.current || targetAudio.paused) {
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
  }, [audioSource, enteredRef, syncElementToLiveClock]);

  /**
   * Seamless handoff from Web Audio DSP element -> clean native <audio> element.
   * Called when user turns DSP off OR when iPhone screen locks (visibilitychange -> hidden).
   */
  const handoffToDirect = useCallback(() => {
    const direct = audioRef.current;
    const dspAudio = dspAudioRef.current;
    if (!direct || activeModeRef.current === 'direct') {
      return;
    }

    const wasPlaying = playIntentRef.current;
    const fromTime =
      dspAudio && Number.isFinite(dspAudio.currentTime) && dspAudio.currentTime > 0
        ? dspAudio.currentTime
        : liveClock.hasEstimate()
          ? liveClock.getTargetSec()
          : 0;

    handingOffRef.current = true;
    activeModeRef.current = 'direct';
    radioDsp.setPlaybackIntent(false);

    direct.muted = false;
    direct.volume = gainToLinear(dspStateRef.current.macros.masterGain);
    if (fromTime > 0 && direct.readyState >= 1) {
      const limit =
        Number.isFinite(direct.duration) && direct.duration > 1 ? direct.duration - 0.5 : fromTime;
      try {
        direct.currentTime = Math.max(0, Math.min(fromTime, limit));
      } catch {
        // ignore seek before ready
      }
    }

    if (wasPlaying) {
      radioDsp.requestPlaybackAudioSession();
      void direct
        .play()
        .then(() => {
          if (dspAudio && !dspAudio.paused) {
            dspAudio.pause();
          }
          handingOffRef.current = false;
          setAudioBlocked(false);
          setIsPlaying(true);
        })
        .catch(() => {
          if (dspAudio && !dspAudio.paused) {
            dspAudio.pause();
          }
          handingOffRef.current = false;
          if (document.visibilityState !== 'hidden') {
            setAudioBlocked(true);
            setIsPlaying(false);
          }
        });
    } else {
      if (dspAudio && !dspAudio.paused) {
        dspAudio.pause();
      }
      handingOffRef.current = false;
    }
  }, [liveClock]);

  /**
   * Seamless handoff from clean native <audio> -> Web Audio DSP element (foreground only).
   */
  const handoffToDsp = useCallback(async () => {
    const direct = audioRef.current;
    const dspAudio = dspAudioRef.current;
    if (
      !direct ||
      !dspAudio ||
      !audioSource ||
      document.visibilityState === 'hidden' ||
      dspStateRef.current.isDspBypassed ||
      activeModeRef.current === 'dsp' ||
      !playIntentRef.current
    ) {
      return;
    }

    setDspMediaArmed(true);
    const expectedHref = new URL(audioSource, window.location.href).href;
    if (dspAudio.currentSrc !== expectedHref) {
      dspAudio.src = audioSource;
      dspAudio.load();
    }

    const ready = await waitForMetadata(dspAudio, 4500);
    if (
      !ready ||
      !playIntentRef.current ||
      dspStateRef.current.isDspBypassed ||
      document.hidden
    ) {
      return;
    }

    const dsp = dspStateRef.current;
    radioDsp.setPlaybackIntent(true);
    if (!radioDsp.initAndAttach(dspAudio)) {
      radioDsp.setPlaybackIntent(false);
      return;
    }
    radioDsp.setBands(dsp.bands);
    radioDsp.setMacros(dsp.macros);
    radioDsp.setBypass(false);

    const contextReady = radioDsp.resume(false);
    dspAudio.muted = false;
    dspAudio.volume = 1;

    const targetTime =
      Number.isFinite(direct.currentTime) && direct.currentTime > 0
        ? direct.currentTime
        : liveClock.getTargetSec();
    const limit =
      Number.isFinite(dspAudio.duration) && dspAudio.duration > 1
        ? dspAudio.duration - 0.5
        : targetTime;
    try {
      dspAudio.currentTime = Math.max(0, Math.min(targetTime, limit));
    } catch {
      // phase lock will align
    }

    handingOffRef.current = true;
    try {
      await dspAudio.play();
      const running = await contextReady;
      if (
        !running ||
        !playIntentRef.current ||
        dspStateRef.current.isDspBypassed ||
        document.hidden
      ) {
        dspAudio.pause();
        handingOffRef.current = false;
        return;
      }
      activeModeRef.current = 'dsp';
      direct.pause();
      setAudioBlocked(false);
      setIsPlaying(true);
    } catch {
      // Keep clean native audio playing without interruption if DSP handoff fails.
      dspAudio.pause();
      activeModeRef.current = 'direct';
      radioDsp.setPlaybackIntent(false);
    } finally {
      handingOffRef.current = false;
    }
  }, [audioSource, liveClock]);

  handoffToDirectRef.current = handoffToDirect;
  handoffToDspRef.current = handoffToDsp;

  // React to live DSP Bypass toggle while playing in foreground.
  useEffect(() => {
    if (!playIntentRef.current || !enteredRef.current) {
      if (isDspBypassed) {
        activeModeRef.current = 'direct';
      }
      return;
    }
    if (isDspBypassed) {
      if (activeModeRef.current === 'dsp') {
        handoffToDirect();
      }
    } else if (document.visibilityState !== 'hidden' && activeModeRef.current === 'direct') {
      void handoffToDsp();
    }
  }, [isDspBypassed, enteredRef, handoffToDirect, handoffToDsp]);

  const pausePlayback = useCallback(() => {
    const direct = audioRef.current;
    const dspAudio = dspAudioRef.current;
    const epoch = ++transportEpochRef.current;
    playIntentRef.current = false;
    resumeAfterLoadRef.current = false;
    radioDsp.setPlaybackIntent(false);
    setIsPlaying(false);
    setAudioBlocked(false);
    phaseLockRef.current?.reset();

    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }

    // Background tabs get throttled timers (and may be frozen right after a lock-screen tap): pause at once.
    if (document.visibilityState === 'hidden' || activeModeRef.current === 'direct') {
      direct?.pause();
      dspAudio?.pause();
      return;
    }

    // 15 ms fade-out first for DSP path so the pause does not click; a new play() in between cancels the pause.
    radioDsp.fadeOut(15);
    pauseTimerRef.current = window.setTimeout(() => {
      pauseTimerRef.current = null;
      if (transportEpochRef.current === epoch) {
        direct?.pause();
        dspAudio?.pause();
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
    handingOffRef.current = true;
    if (dspAudioRef.current && !dspAudioRef.current.paused) {
      dspAudioRef.current.pause();
    }
    handingOffRef.current = false;
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
        audioLoadedSetRef.current = setKey;
      } else if (audioLoadedSetRef.current !== setKey) {
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
    const active = getActiveAudio();
    if (active && playIntentRef.current && !active.paused) {
      await phaseLockRef.current?.forceResync();
    } else {
      await startPlayback();
    }
  }, [channelIdRef, fetchRadioState, getActiveAudio, startPlayback]);

  const forceResync = useCallback(() => {
    void phaseLockRef.current?.forceResync();
  }, []);

  const prepareAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioSource) {
      return;
    }
    radioDsp.requestPlaybackAudioSession();
    audio.muted = true;
    void audio.play().catch(() => setNeedsGesture(true));
  }, [audioSource]);

  const rollbackBootAudio = useCallback(() => {
    const direct = audioRef.current;
    const dspAudio = dspAudioRef.current;
    ++transportEpochRef.current;
    playIntentRef.current = false;
    radioDsp.setPlaybackIntent(false);
    if (direct) {
      direct.muted = true;
      direct.pause();
    }
    if (dspAudio) {
      dspAudio.muted = true;
      dspAudio.pause();
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

  const handleAudioPlay = useCallback(
    (sourceMode: TransportMode = 'direct') => {
      if (handingOffRef.current) {
        return;
      }
      if (!enteredRef.current || (bootVisibleRef.current && !playIntentRef.current)) {
        return;
      }
      if (sourceMode !== activeModeRef.current && playIntentRef.current) {
        return;
      }
      if (playIntentRef.current) {
        return;
      }
      // Resumed by the system (iOS Lock Screen play button, AirPods tap, interruption ended).
      activeModeRef.current = sourceMode;
      playIntentRef.current = true;
      radioDsp.requestPlaybackAudioSession();
      if (sourceMode === 'direct') {
        const direct = audioRef.current;
        if (direct) {
          direct.muted = false;
          direct.volume = gainToLinear(dspStateRef.current.macros.masterGain);
        }
        setAudioBlocked(false);
        setIsPlaying(true);
        return;
      }
      radioDsp.setPlaybackIntent(true);
      const epoch = transportEpochRef.current;
      void radioDsp.resume(document.visibilityState !== 'hidden').then((running) => {
        if (
          epoch !== transportEpochRef.current ||
          !playIntentRef.current ||
          dspAudioRef.current?.paused
        ) {
          return;
        }
        setIsPlaying(running);
        setAudioBlocked(!running);
      });
    },
    [bootVisibleRef, enteredRef]
  );

  const handleAudioPause = useCallback((sourceMode: TransportMode = 'direct') => {
    if (handingOffRef.current || loadingRef.current) {
      return;
    }
    if (sourceMode !== activeModeRef.current) {
      return;
    }
    const active = sourceMode === 'dsp' ? dspAudioRef.current : audioRef.current;
    if (active?.ended || !playIntentRef.current) {
      return;
    }
    // A pause nobody asked for (phone call, headset unplugged, lock-screen pause): reflect it honestly.
    ++transportEpochRef.current;
    playInFlightRef.current = null;
    resumeAfterLoadRef.current = false;
    playIntentRef.current = false;
    radioDsp.setPlaybackIntent(false);
    setIsPlaying(false);
  }, []);

  const handleAudioError = useCallback((sourceMode: TransportMode = 'direct') => {
    if (sourceMode === 'dsp') {
      if (activeModeRef.current === 'dsp' && playIntentRef.current) {
        handoffToDirectRef.current();
      }
      return;
    }
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

  const handleAudioEnded = useCallback(
    (sourceMode: TransportMode = 'direct') => {
      if (sourceMode !== activeModeRef.current) {
        return;
      }
      // The set finished (foreground OR iPhone Lock Screen background): reload stream for next set.
      resumeAfterLoadRef.current = playIntentRef.current;
      if (document.visibilityState === 'hidden') {
        activeModeRef.current = 'direct';
      }
      void fetchRadioState(channelIdRef.current).then(() => {
        if (audioMetaLoadedRef.current) {
          reloadStreamRef.current();
        }
      });
    },
    [channelIdRef, fetchRadioState]
  );

  // iOS / Android Web Audio policy resilience (only relevant when DSP mode is active).
  useEffect(() => {
    return radioDsp.subscribe((event) => {
      if (activeModeRef.current !== 'dsp') {
        return;
      }
      if (event === 'background-suspended') {
        // Screen locked while DSP was active: seamlessly hand off to native <audio> without faking pause!
        if (playIntentRef.current) {
          handoffToDirectRef.current();
        }
        return;
      }
      setAudioBlocked(event === 'blocked');
      if (event === 'blocked') {
        if (document.visibilityState === 'hidden' && playIntentRef.current) {
          handoffToDirectRef.current();
        } else {
          setIsPlaying(false);
        }
      } else if (
        enteredRef.current &&
        playIntentRef.current &&
        dspAudioRef.current &&
        !dspAudioRef.current.paused
      ) {
        setIsPlaying(true);
      }
    });
  }, [enteredRef]);

  // Lock-screen & foreground lifecycle:
  // - Going hidden: NEVER seek, NEVER zero fadeGainNode, NEVER call radioDsp.resume(fadeIn).
  //   If DSP was active, immediately hand off to the clean native <audio> element!
  // - Returning visible: re-anchor live clock, recover if OS paused playback, and restore DSP if enabled.
  useEffect(() => {
    const onEnterBackground = () => {
      // Stop timer-driven rate nudges cleanly without touching currentTime.
      phaseLockRef.current?.checkNow();
      if (playIntentRef.current && activeModeRef.current === 'dsp') {
        handoffToDirectRef.current();
      }
    };

    const recoverForeground = async () => {
      if (!playIntentRef.current) {
        return;
      }
      if (!fetchInFlightRef.current) {
        void fetchRadioState(channelIdRef.current);
      }
      const active = getActiveAudio();
      if (!active) {
        return;
      }
      if (active.paused && !active.ended && !loadingRef.current) {
        await startPlaybackRef.current();
        return;
      }
      if (activeModeRef.current === 'direct') {
        setAudioBlocked(false);
        setIsPlaying(!active.paused);
        phaseLockRef.current?.checkNow();
        if (!dspStateRef.current.isDspBypassed) {
          void handoffToDspRef.current();
        }
      } else {
        const running = await radioDsp.resume(false);
        if (!playIntentRef.current) {
          return;
        }
        if (!running) {
          handoffToDirectRef.current();
          return;
        }
        setAudioBlocked(false);
        setIsPlaying(!active.paused);
        phaseLockRef.current?.checkNow();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        onEnterBackground();
      } else {
        void recoverForeground();
      }
    };
    const onPageHide = () => onEnterBackground();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        void recoverForeground();
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
  }, [channelIdRef, fetchInFlightRef, fetchRadioState, getActiveAudio]);

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
      // Never disturb background playback on iOS Lock Screen with boot/readiness seeks.
      if (document.hidden && !bootVisibleRef.current) {
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
    dspAudioRef,
    audioSource,
    dspAudioSource,
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
