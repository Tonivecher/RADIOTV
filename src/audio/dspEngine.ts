export interface DspMacroState {
  subBass: number;      // 0..100
  warmthDrive: number;  // 0..100
  airPresence: number;  // 0..100
  compGlue: number;     // 0..100
  masterGain: number;   // 0..100
}

export interface AudioPreset {
  id: string;
  name: string;
  subtitle: string;
  bands: number[]; // 10 gains in dB
  macros: Omit<DspMacroState, 'masterGain'>;
  isCustom?: boolean;
}

export const EQ_GAIN_LIMIT_DB = 2;
export const NEUTRAL_BANDS = Array<number>(10).fill(0);
export const NEUTRAL_MACROS: DspMacroState = {
  subBass: 0,
  warmthDrive: 0,
  airPresence: 0,
  compGlue: 0,
  masterGain: 85,
};

export const clampEqGain = (value: number): number =>
  Number.isFinite(value) ? Math.max(-EQ_GAIN_LIMIT_DB, Math.min(EQ_GAIN_LIMIT_DB, value)) : 0;

export const clampEqBands = (values: number[]): number[] =>
  NEUTRAL_BANDS.map((_, index) => clampEqGain(values[index] ?? 0));

export function clampDspMacros(
  values: Partial<DspMacroState>,
  fallback: DspMacroState = NEUTRAL_MACROS
): DspMacroState {
  const result = { ...fallback };
  for (const key of Object.keys(NEUTRAL_MACROS) as Array<keyof DspMacroState>) {
    const value = values[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = Math.max(0, Math.min(100, value));
    }
  }
  return result;
}

export const EQ_FREQUENCIES: Array<{ freq: number; label: string; type: BiquadFilterType; q: number }> = [
  { freq: 32, label: '32', type: 'lowshelf', q: 0.7 },
  { freq: 64, label: '64', type: 'peaking', q: 1.1 },
  { freq: 125, label: '125', type: 'peaking', q: 1.2 },
  { freq: 250, label: '250', type: 'peaking', q: 1.2 },
  { freq: 500, label: '500', type: 'peaking', q: 1.2 },
  { freq: 1000, label: '1K', type: 'peaking', q: 1.2 },
  { freq: 2000, label: '2K', type: 'peaking', q: 1.2 },
  { freq: 4000, label: '4K', type: 'peaking', q: 1.2 },
  { freq: 8000, label: '8K', type: 'peaking', q: 1.1 },
  { freq: 16000, label: '16K', type: 'highshelf', q: 0.7 },
];

export const BUILTIN_PRESETS: AudioPreset[] = [
  {
    id: 'flat',
    name: 'Pure Direct',
    subtitle: 'Линейный студийный тракт 0 dB',
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    macros: { subBass: 0, warmthDrive: 0, airPresence: 0, compGlue: 0 },
  },
  {
    id: 'giegling_dub',
    name: 'Giegling Dub',
    subtitle: 'Глубокий даб-низ и мягкая виниловая середина',
    bands: [1.1, 1.3, 0.6, 0.1, -0.4, -0.3, -0.5, 0.1, 0.5, 0.6],
    macros: { subBass: 65, warmthDrive: 38, airPresence: 30, compGlue: 45 },
  },
  {
    id: 'tresor_bunker',
    name: 'Berlin Bunker',
    subtitle: 'Плотный саб-панч 64 Гц и острая перкуссия',
    bands: [1.5, 1.6, 0.8, -0.4, -0.6, 0.0, 0.4, 0.9, 1.1, 1.0],
    macros: { subBass: 82, warmthDrive: 25, airPresence: 55, compGlue: 65 },
  },
  {
    id: 'waking_morning',
    name: 'Outro Lado Morning',
    subtitle: 'Теплый лесной воздух и широкая панорама',
    bands: [0.6, 0.8, 0.5, 0.4, 0.1, 0.0, 0.3, 0.6, 1.0, 1.3],
    macros: { subBass: 35, warmthDrive: 30, airPresence: 75, compGlue: 25 },
  },
  {
    id: 'nagra_tape',
    name: 'Nagra Master Tape',
    subtitle: 'Ламповая сатурация ленты и эфирная компрессия',
    bands: [0.8, 1.0, 0.9, 0.5, 0.3, 0.1, -0.1, -0.3, 0.4, 0.3],
    macros: { subBass: 48, warmthDrive: 68, airPresence: 20, compGlue: 78 },
  },
  {
    id: 'late_night',
    name: 'Night Selector',
    subtitle: 'Ночной баланс без резких пиков',
    bands: [0.9, 0.8, 0.3, 0.0, -0.3, -0.5, -0.8, -0.4, 0.3, 0.5],
    macros: { subBass: 45, warmthDrive: 22, airPresence: 25, compGlue: 60 },
  },
];

function buildWarmthCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 4096;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const k = (amount / 100) * 0.35;
  const norm = Math.tanh(k);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = norm > 0.0001 ? Math.tanh(k * x) / norm : x;
  }
  return curve;
}

type EngineEvent = 'running' | 'blocked' | 'background-suspended';

/** Fade applied to the output bus when audio starts or the context wakes up (hides the first-sample click). */
const UNLOCK_FADE_SEC = 1.5;
/** -60 dB: the floor used by the micro-fade around a live-resync seek. */
const DUCK_FLOOR_GAIN = 0.001;
const DUCK_DOWN_SEC = 0.008;
const RESYNC_FADE_UP_SEC = 0.04;
/** Safari occasionally leaves AudioContext.resume() pending forever. */
const RESUME_TIMEOUT_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitForMediaEvent(
  el: HTMLMediaElement,
  type: 'seeked' | 'canplay',
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve) => {
    let timer = 0;
    const done = () => {
      el.removeEventListener(type, done);
      window.clearTimeout(timer);
      resolve();
    };
    el.addEventListener(type, done, { once: true });
    timer = window.setTimeout(done, timeoutMs);
  });
}

class RadioDspEngine {
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private subShelfNode: BiquadFilterNode | null = null;
  private airShelfNode: BiquadFilterNode | null = null;
  private shaperNode: WaveShaperNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private headroomGainNode: GainNode | null = null;
  private responseProbeNode: BiquadFilterNode | null = null;
  private responseFrequencies = new Float32Array(new ArrayBuffer(512 * 4));
  private responseMagnitude = new Float32Array(new ArrayBuffer(512 * 4));
  private responsePhase = new Float32Array(new ArrayBuffer(512 * 4));
  private graphKey = '';
  private masterGainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  /** Last gain stage before the speakers: owns click-free start / stop / resync fades. */
  private fadeGainNode: GainNode | null = null;
  private meterMixNode: GainNode | null = null;
  private meterSplitter: ChannelSplitterNode | null = null;
  private meterAnalyserL: AnalyserNode | null = null;
  private meterAnalyserR: AnalyserNode | null = null;
  private meterSinkNode: GainNode | null = null;
  private meterBufL: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(1024 * 4));
  private meterBufR: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(1024 * 4));
  private timeDomainBuf: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(256));
  private freqDomainBuf: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(128));
  private connectedAudioEl: HTMLAudioElement | null = null;
  private isBypassed = true;
  private playbackIntent = false;
  private fadeRevision = 0;
  private listeners = new Set<(event: EngineEvent) => void>();

  private currentBands: number[] = [...NEUTRAL_BANDS];
  private currentMacros: DspMacroState = { ...NEUTRAL_MACROS };

  /**
   * Builds the DSP graph and attaches it to the <audio> element.
   * Does NOT resume the context: call `resume()` from a user gesture.
   */
  public initAndAttach(audioEl: HTMLAudioElement): boolean {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.ctx) {
        try {
          // 'playback' = larger buffers, fewer glitches and less battery drain on phones.
          this.ctx = new AudioCtx({ latencyHint: 'playback' });
        } catch {
          this.ctx = new AudioCtx();
        }
        this.ctx.addEventListener('statechange', this.handleContextStateChange);
        if (this.playbackIntent) this.requestPlaybackAudioSession();
      }

      if (this.connectedAudioEl === audioEl && this.sourceNode) {
        this.applyAllParameters();
        return true;
      }

      this.connectedAudioEl = audioEl;
      this.sourceNode = this.ctx.createMediaElementSource(audioEl);

      // Reserve headroom before any boosts or nonlinearity. The probe is never connected.
      this.headroomGainNode = this.ctx.createGain();
      this.responseProbeNode = this.ctx.createBiquadFilter();
      const nyquist = this.ctx.sampleRate / 2;
      this.responseFrequencies = Float32Array.from({ length: 512 }, (_, i) =>
        i === 0 ? 0 : i === 511 ? nyquist : 10 * Math.pow(nyquist / 10, (i - 1) / 509));

      // 10-band EQ chain
      this.eqNodes = EQ_FREQUENCIES.map((cfg, idx) => {
        const filter = this.ctx!.createBiquadFilter();
        filter.type = cfg.type;
        filter.frequency.value = cfg.freq;
        filter.Q.value = cfg.q;
        filter.gain.value = this.currentBands[idx] || 0;
        return filter;
      });

      // Sub-Bass Boost Shelf (52 Hz)
      this.subShelfNode = this.ctx.createBiquadFilter();
      this.subShelfNode.type = 'lowshelf';
      this.subShelfNode.frequency.value = 52;

      // Air Presence Shelf (12.5 kHz)
      this.airShelfNode = this.ctx.createBiquadFilter();
      this.airShelfNode.type = 'highshelf';
      this.airShelfNode.frequency.value = 12500;

      // Analog Warmth Saturation
      this.shaperNode = this.ctx.createWaveShaper();
      this.shaperNode.curve = null;
      this.shaperNode.oversample = '2x';

      // Mastering Broadcast Compressor
      this.compressorNode = this.ctx.createDynamicsCompressor();
      this.compressorNode.threshold.value = -12;
      this.compressorNode.knee.value = 12;
      this.compressorNode.ratio.value = 1;
      this.compressorNode.attack.value = 0.008;
      this.compressorNode.release.value = 0.18;

      // Master Gain
      this.masterGainNode = this.ctx.createGain();

      // FFT & Waveform Analyser
      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.78;
      this.timeDomainBuf = new Uint8Array(new ArrayBuffer(this.analyserNode.fftSize));
      this.freqDomainBuf = new Uint8Array(new ArrayBuffer(this.analyserNode.frequencyBinCount));

      // Output fade stage (click-free start / pause / live-resync)
      this.fadeGainNode = this.ctx.createGain();

      // True stereo level metering. The mix node up-mixes mono sources to 2 channels because the
      // splitter is 'discrete' and would otherwise leave the right meter dead.
      this.meterMixNode = this.ctx.createGain();
      this.meterMixNode.channelCount = 2;
      this.meterMixNode.channelCountMode = 'explicit';
      this.meterMixNode.channelInterpretation = 'speakers';
      this.meterSplitter = this.ctx.createChannelSplitter(2);
      this.meterAnalyserL = this.ctx.createAnalyser();
      this.meterAnalyserR = this.ctx.createAnalyser();
      for (const a of [this.meterAnalyserL, this.meterAnalyserR]) {
        a.fftSize = 1024;
        a.smoothingTimeConstant = 0;
      }
      this.meterBufL = new Float32Array(new ArrayBuffer(this.meterAnalyserL.fftSize * 4));
      this.meterBufR = new Float32Array(new ArrayBuffer(this.meterAnalyserR.fftSize * 4));
      // Silent sink keeps the meter analysers inside the pulled graph (Safari ignores dangling ones).
      this.meterSinkNode = this.ctx.createGain();
      this.meterSinkNode.gain.value = 0;
      this.meterMixNode.connect(this.meterSplitter);
      this.meterSplitter.connect(this.meterAnalyserL, 0);
      this.meterSplitter.connect(this.meterAnalyserR, 1);
      this.meterAnalyserL.connect(this.meterSinkNode);
      this.meterAnalyserR.connect(this.meterSinkNode);
      this.meterSinkNode.connect(this.ctx.destination);

      this.graphKey = '';
      this.applyAllParameters();
      return true;
    } catch {
      return false;
    }
  }

  private rewireGraph(): void {
    if (
      !this.ctx ||
      !this.sourceNode ||
      !this.masterGainNode ||
      !this.analyserNode ||
      !this.fadeGainNode
    ) {
      return;
    }

    const processing = !this.isBypassed && this.hasProcessing();
    const graphKey = processing
      ? `processed:${this.currentMacros.warmthDrive > 0}:${this.currentMacros.compGlue > 0}`
      : 'direct';
    if (this.graphKey === graphKey) return;
    this.graphKey = graphKey;

    try {
      this.sourceNode.disconnect();
      this.eqNodes.forEach((n) => n.disconnect());
      this.subShelfNode?.disconnect();
      this.airShelfNode?.disconnect();
      this.shaperNode?.disconnect();
      this.compressorNode?.disconnect();
      this.headroomGainNode?.disconnect();
      this.masterGainNode.disconnect();
      this.analyserNode.disconnect();
      this.fadeGainNode.disconnect();
    } catch {
      // ignore disconnect errors
    }

    const connectTail = () => {
      this.masterGainNode!.connect(this.analyserNode!);
      this.analyserNode!.connect(this.fadeGainNode!);
      this.fadeGainNode!.connect(this.ctx!.destination);
      if (this.meterMixNode) this.analyserNode!.connect(this.meterMixNode);
    };

    if (!processing) {
      this.sourceNode.connect(this.masterGainNode);
      connectTail();
      return;
    }

    let prev: AudioNode = this.sourceNode;
    if (this.headroomGainNode) {
      prev.connect(this.headroomGainNode);
      prev = this.headroomGainNode;
    }
    for (const eq of this.eqNodes) {
      prev.connect(eq);
      prev = eq;
    }
    if (this.subShelfNode) {
      prev.connect(this.subShelfNode);
      prev = this.subShelfNode;
    }
    if (this.airShelfNode) {
      prev.connect(this.airShelfNode);
      prev = this.airShelfNode;
    }
    if (this.shaperNode && this.currentMacros.warmthDrive > 0) {
      prev.connect(this.shaperNode);
      prev = this.shaperNode;
    }
    if (this.compressorNode && this.currentMacros.compGlue > 0) {
      prev.connect(this.compressorNode);
      prev = this.compressorNode;
    }
    prev.connect(this.masterGainNode);
    connectTail();
  }

  // ───────────────────────── Context lifecycle (iOS / Android resilience) ─────────────────────────

  private handleContextStateChange = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = ctx.state as string;
    if (state === 'running') {
      this.emit('running');
      return;
    }
    // While screen is locked or tab is hidden on iOS, WebKit suspends/interrupts AudioContext.
    // Never emit 'blocked' (which would pause UI/MediaSession); notify transport to keep native audio alive.
    if (document.visibilityState === 'hidden') {
      if (this.playbackIntent) {
        this.emit('background-suspended');
      }
      return;
    }
    // A call or Siri owns an interrupted session. Let the system release it first.
    if (state === 'interrupted' || this.isSessionInterrupted()) {
      if (this.playbackIntent) this.emit('blocked');
      return;
    }
    if (this.playbackIntent && state === 'suspended') {
      void this.resume(false).then((ok) => {
        if (!ok && document.visibilityState !== 'hidden') this.emit('blocked');
      });
    }
  };

  private emit(event: EngineEvent): void {
    this.listeners.forEach((cb) => cb(event));
  }

  /** Subscribe to 'running' / 'blocked' / 'background-suspended' notifications. Returns an unsubscribe function. */
  public subscribe(cb: (event: EngineEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Tells the engine whether the listener expects sound (enables auto-wake on interruptions). */
  public setPlaybackIntent(intent: boolean): void {
    this.playbackIntent = intent;
    if (intent) this.requestPlaybackAudioSession();
  }

  public isRunning(): boolean {
    return !!this.ctx && (this.ctx.state as string) === 'running';
  }

  public hasContext(): boolean {
    return this.ctx !== null;
  }

  public isAttachedTo(audioEl: HTMLAudioElement | null): boolean {
    return Boolean(audioEl && this.connectedAudioEl === audioEl && this.sourceNode);
  }

  /**
   * Request the platform's playback category before starting audio (iOS Safari AudioSession API).
   * Feature detection keeps older browsers usable without a fake permission prompt.
   */
  public requestPlaybackAudioSession(): void {
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
    } catch {
      // not supported
    }
  }

  private isSessionInterrupted(): boolean {
    return (navigator as unknown as { audioSession?: { state?: string } }).audioSession?.state === 'interrupted';
  }

  public setUnityGain(): void {
    if (!this.ctx || !this.fadeGainNode) return;
    ++this.fadeRevision;
    const g = this.fadeGainNode.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
  }

  private scheduleFadeIn(durationSec = UNLOCK_FADE_SEC): void {
    if (!this.ctx || !this.fadeGainNode) return;
    // Never zero output gain while page is hidden/locked: throttled/frozen iOS timers can trap gain at 0.
    if (document.visibilityState === 'hidden') {
      this.setUnityGain();
      return;
    }
    ++this.fadeRevision;
    const g = this.fadeGainNode.gain;
    // While the context is suspended currentTime is frozen, so this ramp starts the instant it wakes up.
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1, t + durationSec);
  }

  /**
   * Wakes the AudioContext. Must be called synchronously inside a user gesture on iOS.
   * Pass `withFadeIn` to raise playback gently to the selected volume over 1.5 seconds.
   * Resolves true once the context is actually running.
   */
  public resume(withFadeIn = false): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(false);
    if (this.isSessionInterrupted()) return Promise.resolve(false);
    if (this.playbackIntent) this.requestPlaybackAudioSession();
    const running = (ctx.state as string) === 'running';
    if (document.visibilityState === 'hidden') {
      // Never ramp from 0 in the background.
      this.setUnityGain();
      if (running) return Promise.resolve(true);
    } else if (withFadeIn || !running) {
      this.scheduleFadeIn();
    } else {
      this.setUnityGain();
    }
    if (running) return Promise.resolve(true);

    const wake = ctx
      .resume()
      .then(() => true)
      .catch(() => false);
    const timeout = delay(RESUME_TIMEOUT_MS).then(() => false);
    return Promise.race([wake, timeout]).then(() => (ctx.state as string) === 'running');
  }

  /** Ramps the output bus to silence (default 15 ms) so a following `pause()` does not click. */
  public fadeOut(durationMs = 15): void {
    ++this.fadeRevision;
    if (!this.ctx || !this.fadeGainNode || !this.isRunning()) return;
    const g = this.fadeGainNode.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + durationMs / 1000);
  }

  /**
   * Seeks the element to `resolveTargetSec()` without an audible click:
   * duck to -60 dB (8 ms) → seek → ramp back to 0 dB over 40 ms.
   * The target is resolved at the moment of the seek so fade latency does not add drift.
   */
  public async seekWithMicroFade(
    audio: HTMLAudioElement,
    resolveTargetSec: () => number
  ): Promise<void> {
    const ctx = this.ctx;
    const fade = this.fadeGainNode;
    const doSeek = () => {
      try {
        audio.currentTime = resolveTargetSec();
      } catch {
        // metadata not ready yet
      }
    };

    if (document.hidden || !ctx || !fade || audio !== this.connectedAudioEl || !this.isRunning()) {
      doSeek();
      return;
    }

    const g = fade.gain;
    const revision = ++this.fadeRevision;
    let t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(DUCK_FLOOR_GAIN, g.value), t);
    g.exponentialRampToValueAtTime(DUCK_FLOOR_GAIN, t + DUCK_DOWN_SEC);
    // AudioParam automation runs in the audio pipeline even if iOS freezes JS after lock.
    // Never leave the output waiting at -60 dB for a throttled timer to restore it.
    g.setValueAtTime(DUCK_FLOOR_GAIN, t + 0.1);
    g.exponentialRampToValueAtTime(1, t + 0.1 + RESYNC_FADE_UP_SEC);

    try {
      await delay(Math.ceil(DUCK_DOWN_SEC * 1000) + 4);
      if (revision !== this.fadeRevision) return;
      if (document.hidden) {
        doSeek();
        return;
      }
      const seeked = waitForMediaEvent(audio, 'seeked', 2500);
      doSeek();
      await seeked;
      if (audio.readyState < 3) await waitForMediaEvent(audio, 'canplay', 1500);
    } finally {
      // A newer pause/start owns the gain; an old seek must not override it.
      if (revision === this.fadeRevision) {
        t = ctx.currentTime;
        const current = Math.max(DUCK_FLOOR_GAIN, g.value);
        g.cancelScheduledValues(t);
        g.setValueAtTime(current, t);
        g.exponentialRampToValueAtTime(1, t + RESYNC_FADE_UP_SEC);
      }
    }
  }

  public setBypass(bypass: boolean): void {
    this.isBypassed = bypass;
    this.applyAllParameters();
  }

  public setBands(bands: number[]): void {
    this.currentBands = clampEqBands(bands);
    this.applyAllParameters();
  }

  public setBandGain(index: number, gainDb: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= 10) return;
    this.currentBands[index] = clampEqGain(gainDb);
    this.applyAllParameters();
  }

  public setMacros(macros: Partial<DspMacroState>): void {
    this.currentMacros = clampDspMacros(macros, this.currentMacros);
    this.applyAllParameters();
  }

  private hasProcessing(): boolean {
    const { subBass, warmthDrive, airPresence, compGlue } = this.currentMacros;
    return this.currentBands.some((gain) => gain !== 0) ||
      subBass > 0 || warmthDrive > 0 || airPresence > 0 || compGlue > 0;
  }

  /** Combined target EQ response, with 1 dB of extra margin and the maximum warmth gain. */
  private getHeadroomGain(): number {
    const probe = this.responseProbeNode;
    if (!probe || !this.hasProcessing()) return 1;
    const combined = new Float64Array(this.responseFrequencies.length).fill(1);
    const filters = [
      ...EQ_FREQUENCIES.map((band, index) => ({ ...band, gain: this.currentBands[index] })),
      { type: 'lowshelf' as BiquadFilterType, freq: 52, q: 1, gain: this.currentMacros.subBass / 100 * 2 },
      { type: 'highshelf' as BiquadFilterType, freq: 12500, q: 1, gain: this.currentMacros.airPresence / 100 * 1.5 },
    ];
    for (const filter of filters) {
      if (filter.gain === 0) continue;
      probe.type = filter.type;
      probe.frequency.value = filter.freq;
      probe.Q.value = filter.q;
      probe.gain.value = filter.gain;
      probe.getFrequencyResponse(this.responseFrequencies, this.responseMagnitude, this.responsePhase);
      for (let i = 0; i < combined.length; i++) combined[i] *= this.responseMagnitude[i];
    }
    const maxBoost = Math.max(1, ...combined);
    const warmth = this.currentMacros.warmthDrive / 100 * 0.35;
    const warmthGain = warmth > 0 ? warmth / Math.tanh(warmth) : 1;
    return 1 / (maxBoost * warmthGain * Math.pow(10, 1 / 20));
  }

  private applyAllParameters(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    this.eqNodes.forEach((node, i) => {
      node.gain.setTargetAtTime(this.currentBands[i] ?? 0, now, 0.025);
    });

    if (this.subShelfNode) {
      const subDb = (this.currentMacros.subBass / 100) * 2;
      this.subShelfNode.gain.setTargetAtTime(subDb, now, 0.03);
    }

    if (this.airShelfNode) {
      const airDb = (this.currentMacros.airPresence / 100) * 1.5;
      this.airShelfNode.gain.setTargetAtTime(airDb, now, 0.03);
    }

    if (this.shaperNode) {
      this.shaperNode.curve = this.currentMacros.warmthDrive > 0
        ? buildWarmthCurve(this.currentMacros.warmthDrive) : null;
    }

    if (this.compressorNode) {
      const glue = this.currentMacros.compGlue / 100;
      this.compressorNode.threshold.setTargetAtTime(-12 - glue * 6, now, 0.04);
      this.compressorNode.ratio.setTargetAtTime(1 + glue * 1.5, now, 0.04);
    }

    if (this.headroomGainNode) {
      const gain = this.isBypassed ? 1 : this.getHeadroomGain();
      this.headroomGainNode.gain.setTargetAtTime(gain, now, 0.01);
    }

    if (this.masterGainNode) {
      const gainLinear = Math.pow(this.currentMacros.masterGain / 100, 1.6);
      this.masterGainNode.gain.setTargetAtTime(gainLinear, now, 0.02);
    }
    this.rewireGraph();
  }

  /**
   * True per-channel levels (linear 0..1, unscaled) measured after the master gain, before the
   * output fade. Returns null while the context is not running so callers can show silence.
   */
  public getStereoLevels(): { rmsL: number; rmsR: number; peakL: number; peakR: number } | null {
    const aL = this.meterAnalyserL;
    const aR = this.meterAnalyserR;
    if (!aL || !aR || !this.isRunning()) return null;

    aL.getFloatTimeDomainData(this.meterBufL);
    aR.getFloatTimeDomainData(this.meterBufR);

    const measure = (buf: Float32Array<ArrayBuffer>): { rms: number; peak: number } => {
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        sumSq += v * v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      return { rms: Math.sqrt(sumSq / buf.length), peak: Math.min(1, peak) };
    };

    const l = measure(this.meterBufL);
    const r = measure(this.meterBufR);
    return { rmsL: l.rms, rmsR: r.rms, peakL: l.peak, peakR: r.peak };
  }

  public getSpectrumAndMeters(isPlaying: boolean): {
    bins: number[];
    waveform: number[];
    rmsL: number;
    rmsR: number;
    dbL: number;
    dbR: number;
  } {
    if (!isPlaying) {
      return {
        bins: new Array(32).fill(0),
        waveform: new Array(64).fill(0),
        rmsL: 0,
        rmsR: 0,
        dbL: -60,
        dbR: -60,
      };
    }

    if (this.analyserNode && this.ctx && this.ctx.state === 'running') {
      this.analyserNode.getByteFrequencyData(this.freqDomainBuf);
      this.analyserNode.getByteTimeDomainData(this.timeDomainBuf);

      const bins: number[] = [];
      const step = Math.max(1, Math.floor(this.freqDomainBuf.length / 32));
      let energySum = 0;

      for (let i = 0; i < 32; i++) {
        const raw = this.freqDomainBuf[Math.min(this.freqDomainBuf.length - 1, i * step)] / 255;
        bins.push(raw);
        energySum += raw;
      }

      const waveform: number[] = [];
      for (let i = 0; i < 64; i++) {
        waveform.push((this.timeDomainBuf[i * 2] - 128) / 128);
      }

      if (energySum > 0.2) {
        // Same display gain (×2.6) as before, but fed by the real L/R analysers.
        const levels = this.getStereoLevels();
        const rmsL = Math.min(1, (levels ? levels.rmsL : 0) * 2.6);
        const rmsR = Math.min(1, (levels ? levels.rmsR : 0) * 2.6);
        const dbL = Math.max(-48, Math.min(0, 20 * Math.log10(Math.max(0.004, rmsL))));
        const dbR = Math.max(-48, Math.min(0, 20 * Math.log10(Math.max(0.004, rmsR))));
        return { bins, waveform, rmsL, rmsR, dbL, dbR };
      }
    }

    return {
      bins: new Array(32).fill(0),
      waveform: new Array(64).fill(0),
      rmsL: 0,
      rmsR: 0,
      dbL: -60,
      dbR: -60,
    };
  }
}

export const radioDsp = new RadioDspEngine();
