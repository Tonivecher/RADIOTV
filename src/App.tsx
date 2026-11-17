import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { AmbientHeader } from './components/AmbientHeader';
import { AuthShieldModal } from './components/AuthShieldModal';
import { BootPreloader } from './components/BootPreloader';
import { ChannelLoungeSection } from './components/ChannelLoungeSection';
import {
  ChannelTransition,
  ChannelTransitionPortal,
} from './components/ChannelTransitionPortal';
import { DspEqualizerConsole } from './components/DspEqualizerConsole';
import {
  BackgroundHandle,
  BackgroundMediaInfo,
  EveningBackground,
} from './components/EveningBackground';
import { FloatingMiniDock } from './components/FloatingMiniDock';
import { HeroTransportStage } from './components/HeroTransportStage';
import { LiveBeaconIcon, RadioIcon } from './components/icons/RadioIcons';
import { LiveEtherChat } from './components/LiveEtherChat';
import { RadioMark } from './components/RadioMark';
import {
  BackgroundMotionControl,
  MagneticMark,
  SpatialMotionProvider,
} from './components/SpatialMotion';
import { StationWordmark } from './components/StationWordmark';
import { resolveThemeForChannel } from './constants/ascii';
import { CHANNEL_COPY, REACTION_TO_ICON } from './constants/radio';
import { useAudioTransport } from './hooks/useAudioTransport';
import { useDspController } from './hooks/useDspController';
import { useLiveRadioState } from './hooks/useLiveRadioState';
import { useMediaSession } from './hooks/useMediaSession';
import { useRadioSession } from './hooks/useRadioSession';
import { ChatMessageItem, ReactionKind, WaveformMoment } from './types/radio';
import { describeSync } from './utils/radioState';
import { safeStorage } from './utils/storage';

export const App: React.FC = () => {
  const reducedMotion = useReducedMotion();

  const [showBootloader, setShowBootloader] = useState(true);
  const [bootRevealed, setBootRevealed] = useState(false);
  const [portalTransition, setPortalTransition] = useState<ChannelTransition | null>(null);
  const bootVisibleRef = useRef(true);
  const enteredRef = useRef(false);
  bootVisibleRef.current = showBootloader && !enteredRef.current;

  const contentRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<BackgroundHandle>(null);
  const [bgMedia, setBgMedia] = useState<BackgroundMediaInfo>({
    blobUrl: '',
    sourceUrl: '/media/evening-desktop.mp4',
    posterUrl: '/media/evening-poster.jpg',
  });
  const [videoControlsHost, setVideoControlsHost] = useState<HTMLDivElement | null>(null);
  const [videoRetry, setVideoRetry] = useState(0);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [showMiniDock, setShowMiniDock] = useState<boolean>(false);

  const broadcastSyncedRef = useRef<(setKey: string) => void>(() => {});
  const radioLive = useLiveRadioState({
    onBroadcastSynced: (setKey) => broadcastSyncedRef.current(setKey),
  });
  const dsp = useDspController();
  const radioSession = useRadioSession();
  const transport = useAudioTransport({
    channelId: radioLive.channelId,
    channelIdRef: radioLive.channelIdRef,
    anchorChannelRef: radioLive.anchorChannelRef,
    currentSetIdRef: radioLive.currentSetIdRef,
    durationRef: radioLive.durationRef,
    liveClock: radioLive.liveClock,
    fetchInFlightRef: radioLive.fetchInFlightRef,
    fetchRadioState: radioLive.fetchRadioState,
    isStateLoaded: radioLive.isStateLoaded,
    stateChannelId: radioLive.radioState.channelId,
    broadcastSetId: radioLive.radioState.broadcast.setId,
    bands: dsp.bands,
    macros: dsp.macros,
    isDspBypassed: dsp.isDspBypassed,
    enteredRef,
    bootVisibleRef,
  });
  broadcastSyncedRef.current = transport.onBroadcastSynced;

  const theme = resolveThemeForChannel(radioLive.channelId);

  // Every channel switch updates transport flags before React swaps <audio src>
  const selectChannel = useCallback(
    (next: string) => {
      const previous = radioLive.channelIdRef.current;
      if (next === previous) {
        return;
      }
      if (!showBootloader) {
        setPortalTransition({ fromChannelId: previous, toChannelId: next });
      } else {
        setPortalTransition(null);
      }
      transport.prepareForChannelSwitch();
      radioLive.switchChannelState(next);
    },
    [radioLive, showBootloader, transport]
  );

  useMediaSession({
    channelId: radioLive.channelId,
    channelIdRef: radioLive.channelIdRef,
    radioState: radioLive.radioState,
    isPlaying: transport.isPlaying,
    livePositionSec: radioLive.livePositionSec,
    liveClock: radioLive.liveClock,
    enteredRef,
    onPlay: () => {
      void transport.startPlayback();
    },
    onPause: transport.pausePlayback,
    onSelectChannel: selectChannel,
    onForceResync: transport.forceResync,
  });

  // Apply active theme to <html data-theme="...">
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    safeStorage.setItem('radiotv_theme', theme);
  }, [theme]);

  // The intro owns the viewport until its doors finish opening.
  useEffect(() => {
    if (!showBootloader) {
      return;
    }
    const html = document.documentElement;
    const previous = {
      overflow: document.body.style.overflow,
      scrollBehavior: html.style.scrollBehavior,
      restoration: history.scrollRestoration,
    };
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
    const dockObserver = new IntersectionObserver(([entry]) =>
      setShowMiniDock(!entry.isIntersecting)
    );
    if (hero) {
      dockObserver.observe(hero);
    }

    return () => {
      observer.disconnect();
      dockObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!showBootloader) {
      contentRef.current
        ?.querySelector<HTMLButtonElement>('.magnetic-cta--hero')
        ?.focus({ preventScroll: true });
    }
  }, [showBootloader]);

  const handleDropMoment = async (
    timestampSec: number,
    reactionType: ReactionKind,
    comment: string
  ) => {
    const data = await radioSession.postAction<{
      moment: WaveformMoment;
      heatmap?: number[];
    }>('moment', '/api/radio/moments', {
      channelId: radioLive.channelId,
      setId: radioLive.radioState.broadcast.setId,
      timestampSec,
      reactionType,
      comment,
    });
    radioLive.applyMoment(data);
  };

  const handleLikeMoment = async (momentId: number) => {
    const data = await radioSession.postAction<{
      moment: WaveformMoment;
      heatmap?: number[];
    }>(`like:${momentId}`, `/api/radio/moments/${momentId}/react`, {});
    radioLive.applyMoment(data);
  };

  const handleSendMessage = async (text: string) => {
    const data = await radioSession.postAction<{ message: ChatMessageItem }>(
      'chat',
      '/api/radio/chat',
      {
        channelId: radioLive.channelId,
        text,
      }
    );
    radioLive.applyMessage(data.message);
  };

  const handleReactToMessage = async (messageId: number, kind: ReactionKind) => {
    const data = await radioSession.postAction<{ message: ChatMessageItem }>(
      `react:${messageId}`,
      `/api/radio/chat/${messageId}/react`,
      { reactionType: kind }
    );
    radioLive.applyMessage(data.message);
  };

  const renderReactionIcon = useCallback((kind: ReactionKind, size = 16) => {
    const iconName = REACTION_TO_ICON[kind] || 'react-fire';
    return <RadioIcon name={iconName} size={size} />;
  }, []);

  const prepareResources = () => {
    backgroundRef.current?.prepare();
    transport.prepareAudio();
  };

  const retryResources = () => {
    if (!isVideoReady || videoError) {
      setVideoError('');
      setIsVideoReady(false);
      setVideoRetry((value) => value + 1);
    }
    if (!radioLive.isStateLoaded || radioLive.stateError) {
      void radioLive.fetchRadioState(radioLive.channelIdRef.current);
    }
    if (!transport.isAudioReady || transport.audioError) {
      transport.reloadStream();
    }
  };

  const bootStateError = transport.audioSource ? '' : radioLive.stateError;

  const handleEnterEther = async (autoPlay: boolean): Promise<boolean> => {
    if (
      !transport.audioSource ||
      radioLive.loadedStateChannelRef.current !== radioLive.channelIdRef.current ||
      !transport.isAudioReady ||
      !isVideoReady ||
      videoError ||
      bootStateError ||
      transport.audioError
    ) {
      return false;
    }
    const audio = transport.audioRef.current;
    if (!autoPlay && audio) {
      audio.pause();
      audio.muted = false;
    }
    enteredRef.current = true;
    bootVisibleRef.current = false;
    if (autoPlay && !(await transport.startPlayback())) {
      transport.rollbackBootAudio();
      enteredRef.current = false;
      bootVisibleRef.current = true;
      return false;
    }
    return true;
  };

  const syncView = describeSync(
    transport.syncSnapshot,
    transport.isPlaying,
    transport.audioBlocked
  );

  return (
    <MotionConfig reducedMotion="user">
      <SpatialMotionProvider>
        <div className={`spatial-root theme-${theme}`}>
          <EveningBackground
            ref={backgroundRef}
            channelId={radioLive.channelId}
            portalActive={Boolean(portalTransition)}
            retry={videoRetry}
            showControls={!showBootloader && !radioSession.authModalOpen && !portalTransition}
            controlsHost={videoControlsHost}
            onMediaChange={setBgMedia}
            onReady={() => {
              setIsVideoReady(true);
              setVideoError('');
            }}
            onError={setVideoError}
            onNeedsGesture={() => transport.setNeedsGesture(true)}
          />

          {/* Hidden HTML5 Live Stream Audio Element (Anonymous stream URL, zero track metadata) */}
          <audio
            ref={transport.audioRef}
            src={transport.audioSource}
            preload="auto"
            crossOrigin="anonymous"
            onLoadedMetadata={transport.handleAudioLoadedMetadata}
            onPlay={transport.handleAudioPlay}
            onPause={transport.handleAudioPause}
            onError={transport.handleAudioError}
            onEnded={transport.handleAudioEnded}
          />

          {/* Fullscreen Multi-Stage Boot Preloader */}
          {showBootloader && (
            <BootPreloader
              isStateLoaded={Boolean(transport.audioSource)}
              isVideoReady={isVideoReady}
              errorText={videoError || bootStateError || transport.audioError}
              needsGesture={transport.needsGesture}
              onPrepare={prepareResources}
              onRetry={retryResources}
              isAudioReady={transport.isAudioReady}
              onEnterEther={handleEnterEther}
              onReveal={() => setBootRevealed(true)}
              onComplete={() => setShowBootloader(false)}
            />
          )}

          <div
            ref={contentRef}
            className="radio-content"
            data-boot-hidden={showBootloader && !bootRevealed ? true : undefined}
            inert={showBootloader || radioSession.authModalOpen || Boolean(portalTransition)}
            aria-hidden={
              showBootloader || radioSession.authModalOpen || Boolean(portalTransition)
                ? true
                : undefined
            }
          >
            {/* Floating Dynamic Glass Island Navigation Bar */}
            <AmbientHeader>
              <div className="floating-glass-island">
                {/* Brand Identity */}
                <div className="island-brand">
                  <span className="island-brand__logo" aria-hidden="true">
                    <MagneticMark>
                      <RadioMark size={34} animate />
                    </MagneticMark>
                  </span>
                  <div className="island-brand__text">
                    <StationWordmark />
                    <span className="island-brand__tag">Музыка на вечер</span>
                  </div>
                </div>

                {/* 3 Live Broadcast Channels */}
                <nav className="island-channels" aria-label="Каналы радиоэфира">
                  {radioLive.radioState.channels.length === 0 && (
                    <span className="island-channel-loading">
                      {radioLive.stateError ? 'Каналы недоступны' : 'Загружаем каналы…'}
                    </span>
                  )}
                  {radioLive.radioState.channels.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      className={`island-channel-btn ${
                        radioLive.channelId === ch.id ? 'is-active' : ''
                      }`}
                      onClick={() => selectChannel(ch.id)}
                      aria-pressed={radioLive.channelId === ch.id}
                    >
                      <LiveBeaconIcon size={14} />
                      <span>{CHANNEL_COPY[ch.id]?.name || ch.name}</span>
                    </button>
                  ))}
                </nav>

                {/* Glass Controls + Showcase Links */}
                <div className="island-actions">
                  <div ref={setVideoControlsHost} className="island-video-control" />
                  <BackgroundMotionControl />
                  <div className="island-links">
                    <a href="#dsp-stage" className="island-link">
                      Звук
                    </a>
                    <a href="#lounge-stage" className="island-link">
                      Каналы
                    </a>
                    <button
                      type="button"
                      className="island-link"
                      onClick={() => {
                        setBootRevealed(false);
                        setShowBootloader(true);
                      }}
                    >
                      О радио
                    </button>
                  </div>
                </div>
              </div>
            </AmbientHeader>

            {/* Main Scroll-Choreographed Spatial Experience */}
            <main className="spatial-main">
              <HeroTransportStage
                isStateLoaded={radioLive.isStateLoaded}
                stateError={radioLive.stateError}
                audioError={transport.audioError}
                isPlaying={transport.isPlaying}
                syncSnapshot={transport.syncSnapshot}
                syncView={syncView}
                masterGain={dsp.macros.masterGain}
                peaks={radioLive.radioState.peaks}
                heatmap={radioLive.radioState.heatmap}
                durationSec={radioLive.radioState.broadcast.durationSec}
                positionSec={radioLive.livePositionSec}
                moments={radioLive.radioState.moments}
                onRetryState={() => void radioLive.fetchRadioState(radioLive.channelId)}
                onRetryAudio={transport.reloadStream}
                onTogglePlay={transport.togglePlay}
                onResyncLive={transport.handleResyncLive}
                onMasterGainChange={(masterGain) => dsp.handleMacroChange({ masterGain })}
                onDropMoment={handleDropMoment}
                onLikeMoment={handleLikeMoment}
                renderReactionIcon={renderReactionIcon}
              />

              {/* SECTION 02: SCROLL-REVEALED 10-BAND SPATIAL DSP CONSOLE */}
              <motion.section
                initial={{ opacity: 0, y: reducedMotion ? 0 : 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.05 }}
                transition={{ duration: 0.7 }}
                id="dsp-stage"
                className="scroll-reveal-section dsp-stage-section"
                aria-label="Настройка звука"
              >
                <DspEqualizerConsole
                  isPlaying={transport.isPlaying}
                  isBypassed={dsp.isDspBypassed}
                  onChangeBypass={dsp.handleDspBypass}
                  bands={dsp.bands}
                  macros={dsp.macros}
                  activePresetId={dsp.activePresetId}
                  customPresets={dsp.customPresets}
                  onSelectPreset={dsp.handleSelectPreset}
                  onChangeBand={dsp.handleBandChange}
                  onChangeMacro={dsp.handleMacroChange}
                  onSaveCustomPreset={dsp.handleSaveCustomPreset}
                  onResetFlat={dsp.handleResetFlat}
                />
              </motion.section>

              {/* SECTION 03: SCROLL-REVEALED SPLIT STUDIO — CHANNELS & LIVE CHAT */}
              <ChannelLoungeSection
                channels={radioLive.radioState.channels}
                channelId={radioLive.channelId}
                onSelectChannel={selectChannel}
              >
                <LiveEtherChat
                  messages={radioLive.radioState.messages}
                  listenersCount={radioLive.radioState.listenersCount}
                  session={radioSession.session}
                  activeSetCode={radioLive.radioState.broadcast.code}
                  currentPositionSec={radioLive.livePositionSec}
                  onSendMessage={handleSendMessage}
                  onReactToMessage={handleReactToMessage}
                  onOpenAuthModal={() => radioSession.setAuthModalOpen(true)}
                  renderReactionIcon={renderReactionIcon}
                />
              </ChannelLoungeSection>
            </main>

            <footer className="radio-footer">
              <MagneticMark>
                <RadioMark size={28} animate />
              </MagneticMark>
              <span>ToniVecherRadio</span>
              <span>Музыка на вечер</span>
            </footer>

            <FloatingMiniDock
              visible={showMiniDock}
              isPlaying={transport.isPlaying}
              channelId={radioLive.channelId}
              positionSec={radioLive.livePositionSec}
              onTogglePlay={transport.togglePlay}
              onDropQuickMoment={(sec) => handleDropMoment(sec, 'fire', '')}
              renderReactionIcon={renderReactionIcon}
            />
          </div>

          {/* PoW Shield Callsign Auth Modal */}
          <AuthShieldModal
            isOpen={radioSession.authModalOpen}
            currentSession={radioSession.session}
            onClose={() => radioSession.setAuthModalOpen(false)}
            onAuthenticated={radioSession.handleAuthenticated}
          />

          <ChannelTransitionPortal
            transition={portalTransition}
            videoSrc={bgMedia.blobUrl || bgMedia.sourceUrl}
            posterUrl={bgMedia.posterUrl}
            onComplete={() => {
              setPortalTransition(null);
              requestAnimationFrame(() =>
                contentRef.current
                  ?.querySelector<HTMLButtonElement>('.magnetic-cta--hero')
                  ?.focus({ preventScroll: true })
              );
            }}
          />
        </div>
      </SpatialMotionProvider>
    </MotionConfig>
  );
};
