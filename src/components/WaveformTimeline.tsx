import { FloatPanel } from './SpatialMotion';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { radioDsp } from '../audio/dspEngine';
import { MeterBallistics, levelToUnit } from '../audio/meterBallistics';
import { REACTION_CATALOG, ReactionKind, WaveformMoment } from '../types/radio';
import { useHiDpiCanvas } from '../utils/hiDpiCanvas';
import { formatTimecode } from '../utils/pow';

interface WaveformTimelineProps {
  peaks: number[];
  heatmap: number[];
  durationSec: number;
  positionSec: number;
  moments: WaveformMoment[];
  isPlaying: boolean;
  onDropMoment: (timestampSec: number, reactionType: ReactionKind, comment: string) => Promise<void>;
  onLikeMoment: (momentId: number) => Promise<void>;
  renderReactionIcon: (kind: ReactionKind, size?: number) => React.ReactNode;
}

interface FloatingBurst {
  id: number;
  xPercent: number;
  kind: ReactionKind;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
}

const BAR_COUNT = 96;
const HOT_THRESHOLD = 0.42;
const PAD_X = 12;
const PAD_TOP = 20;
const PAD_BOTTOM = 24;

/** Reaction -> glow tone: amber, emerald or magenta. */
const REACTION_GLOW: Record<ReactionKind, string> = {
  fire: '#F59E0B',
  acid: '#E85D2A',
  subbass: '#10B981',
  hypnotic: '#58AD99',
  goosebumps: '#D946EF',
  heart: '#E0399B',
};

interface WaveColors {
  unplayed: string;
  played: string;
  hot: string;
  mirror: string;
  accent: string;
  text: string;
}

const readWaveColors = (): WaveColors => {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    unplayed: v('--wave-unplayed', 'rgba(162,176,196,0.18)'),
    played: v('--wave-played', '#7c9ff0'),
    hot: v('--wave-hot', '#58ad99'),
    mirror: v('--wave-mirror', 'rgba(137,126,194,0.36)'),
    accent: v('--accent-primary', '#7c9ff0'),
    text: v('--text-primary', '#ffffff'),
  };
};

interface LiveState {
  bars: number[];
  heatmap: number[];
  progressRatio: number;
  hoverRatio: number | null;
  moments: WaveformMoment[];
  activeMomentId: number | null;
  safeDuration: number;
  isPlaying: boolean;
  metrics: { width: number; height: number; dpr: number };
}

const hasMotion = (): boolean =>
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function draw(
  canvas: HTMLCanvasElement,
  live: LiveState,
  colors: WaveColors,
  level: number,
  particles: Particle[],
  now: number,
  dpr: number,
  w: number,
  h: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const innerW = w - PAD_X * 2;
  const innerH = h - PAD_TOP - PAD_BOTTOM;
  const baseY = PAD_TOP + innerH * 0.68;
  const upperMax = innerH * 0.64;
  const mirrorMax = innerH * 0.28;
  const slot = innerW / BAR_COUNT;
  const barW = Math.max(1.5, slot * 0.64);
  const playheadX = PAD_X + live.progressRatio * innerW;
  const swellSigma = Math.max(24, innerW * 0.06);
  const heatLen = live.heatmap ? live.heatmap.length : 0;

  // One Path2D per colour class: ~10 fills per frame instead of ~200.
  const upper = {
    played: new Path2D(),
    unplayed: new Path2D(),
    hotPlayed: new Path2D(),
    hotUnplayed: new Path2D(),
    hover: new Path2D(),
  };
  const mirror = { played: new Path2D(), unplayed: new Path2D(), hot: new Path2D() };

  for (let i = 0; i < live.bars.length; i++) {
    const barRatio = i / BAR_COUNT;
    const x = PAD_X + i * slot + (slot - barW) / 2;
    const cx = x + barW / 2;
    const isPlayed = barRatio <= live.progressRatio;
    const isHovered = live.hoverRatio !== null && Math.abs(barRatio - live.hoverRatio) < 0.01;
    const heatVal =
      heatLen > 0 ? live.heatmap[Math.min(heatLen - 1, Math.floor(barRatio * heatLen))] || 0 : 0;
    const isHot = heatVal > HOT_THRESHOLD;

    // Bars near the playhead swell with the real, ballistic output level.
    const dist = (cx - playheadX) / swellSigma;
    const swell = 1 + 0.38 * level * Math.exp(-dist * dist);
    const amp = Math.min(1, live.bars[i] * swell);

    const uh = Math.max(2, upperMax * amp);
    const mh = Math.max(1.5, mirrorMax * amp * 0.38);
    const r = barW / 2;

    const target = isHovered
      ? upper.hover
      : isHot
        ? isPlayed
          ? upper.hotPlayed
          : upper.hotUnplayed
        : isPlayed
          ? upper.played
          : upper.unplayed;
    target.roundRect(x, baseY - uh, barW, uh, r);

    const mTarget = isHot ? mirror.hot : isPlayed ? mirror.played : mirror.unplayed;
    mTarget.roundRect(x, baseY + 4, barW, mh, r);
  }

  ctx.fillStyle = colors.unplayed;
  ctx.fill(upper.unplayed);
  ctx.fillStyle = colors.played;
  ctx.fill(upper.played);
  ctx.fillStyle = colors.hot;
  ctx.fill(upper.hotPlayed);
  ctx.globalAlpha = 0.5;
  ctx.fill(upper.hotUnplayed);
  ctx.globalAlpha = 1;
  ctx.fillStyle = colors.text;
  ctx.fill(upper.hover);

  ctx.globalAlpha = 0.42;
  ctx.fillStyle = colors.unplayed;
  ctx.fill(mirror.unplayed);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = colors.mirror;
  ctx.fill(mirror.played);
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = colors.hot;
  ctx.fill(mirror.hot);
  ctx.globalAlpha = 1;

  // Playhead halo breathing with the level meter.
  if (live.progressRatio > 0) {
    const haloR = 26 + level * 46;
    const halo = ctx.createRadialGradient(playheadX, baseY, 0, playheadX, baseY, haloR);
    halo.addColorStop(0, colors.accent);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.1 + level * 0.3;
    ctx.fillStyle = halo;
    ctx.fillRect(playheadX - haloR, baseY - haloR, haloR * 2, haloR * 2);
    ctx.globalAlpha = 1;
  }

  // Listener moments: soft glowing pulses with a faint stem.
  const motion = hasMotion();
  const recent = live.moments.slice(-24);
  const headY = PAD_TOP + 10;
  for (const m of recent) {
    const pct = Math.max(2, Math.min(98, (m.timestampSec / live.safeDuration) * 100));
    const x = (pct / 100) * w;
    const color = REACTION_GLOW[m.reactionType] || colors.accent;
    const active = live.activeMomentId === m.id;
    const pulse = motion ? 0.5 + 0.5 * Math.sin(now / 420 + m.id * 1.7) : 0.6;
    const likeBoost = 1 + Math.min(10, m.likesCount || 0) * 0.04;
    const haloR = (active ? 24 : 15) * likeBoost * (0.85 + pulse * 0.3);

    const stem = ctx.createLinearGradient(0, headY, 0, baseY);
    stem.addColorStop(0, color);
    stem.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = active ? 0.8 : 0.42;
    ctx.fillStyle = stem;
    ctx.fillRect(x - 0.75, headY, 1.5, baseY - headY);

    const glow = ctx.createRadialGradient(x, headY, 0, x, headY, haloR);
    glow.addColorStop(0, color);
    glow.addColorStop(0.35, color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = (active ? 0.55 : 0.28) + pulse * 0.2;
    ctx.fillStyle = glow;
    ctx.fillRect(x - haloR, headY - haloR, haloR * 2, haloR * 2);

    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, headY, active ? 3.6 : 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Reaction burst particles.
  for (const p of particles) {
    const t = p.age / p.life;
    ctx.globalAlpha = Math.max(0, 1 - t) * 0.9;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
  peaks,
  heatmap,
  durationSec,
  positionSec,
  moments,
  isPlaying,
  onDropMoment,
  onLikeMoment,
  renderReactionIcon,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasMetrics = useHiDpiCanvas(canvasRef);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [pinnedSec, setPinnedSec] = useState<number | null>(null);
  const [selectedMomentId, setSelectedMomentId] = useState<number | null>(null);
  const [selectedKind, setSelectedKind] = useState<ReactionKind>('fire');
  const [commentText, setCommentText] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [bursts, setBursts] = useState<FloatingBurst[]>([]);

  const safeDuration = Math.max(1, durationSec || 0);
  const displayPosition = durationSec > 0 ? Math.max(0, Math.min(durationSec, positionSec)) : 0;
  const progressRatio = Math.max(0, Math.min(1, displayPosition / safeDuration));

  // Normalize peaks to 96 acoustic bars
  const bars = useMemo(() => {
    const count = BAR_COUNT;
    if (!peaks || peaks.length === 0) {
      return [];
    }
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      const srcIdx = Math.min(peaks.length - 1, Math.floor((i / count) * peaks.length));
      result.push(Math.max(0, Math.min(1, peaks[srcIdx] || 0)));
    }
    return result;
  }, [peaks]);

  // Active moment near live playhead, hovered, or selected
  const activeMoment = useMemo(() => {
    if (selectedMomentId !== null) {
      const found = moments.find((m) => m.id === selectedMomentId);
      if (found) return found;
    }
    if (hoverRatio !== null) {
      const hoverSec = hoverRatio * safeDuration;
      const nearHover = moments.find(
        (m) => Math.abs(m.timestampSec - hoverSec) <= safeDuration * 0.02
      );
      if (nearHover) return nearHover;
    }
    let closest: WaveformMoment | null = null;
    let minDiff = 14;
    for (const m of moments) {
      const diff = Math.abs(m.timestampSec - positionSec);
      if (diff <= minDiff) {
        minDiff = diff;
        closest = m;
      }
    }
    return closest || (moments.length > 0 ? moments[moments.length - 1] : null);
  }, [moments, selectedMomentId, hoverRatio, safeDuration, positionSec]);

  const targetSec = pinnedSec !== null ? pinnedSec : Math.floor(positionSec);

  // Live state read by the rAF renderer without re-subscribing the loop.
  const liveRef = useRef({
    bars,
    heatmap,
    progressRatio,
    hoverRatio: null as number | null,
    moments,
    activeMomentId: null as number | null,
    safeDuration,
    isPlaying,
    metrics: canvasMetrics,
  });
  liveRef.current = {
    bars,
    heatmap,
    progressRatio,
    hoverRatio,
    moments,
    activeMomentId: activeMoment ? activeMoment.id : null,
    safeDuration,
    isPlaying,
    metrics: canvasMetrics,
  };

  const particlesRef = useRef<Particle[]>([]);
  const knownMomentIdsRef = useRef<Set<number> | null>(null);
  const wakeRef = useRef<() => void>(() => {});
  const burstTimersRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const timers = burstTimersRef.current;
    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  const spawnParticles = (xPercent: number, kind: ReactionKind) => {
    const { metrics } = liveRef.current;
    if (metrics.width === 0) return;
    const innerH = metrics.height - PAD_TOP - PAD_BOTTOM;
    const x = (xPercent / 100) * metrics.width;
    const y = PAD_TOP + innerH * 0.68;
    const color = REACTION_GLOW[kind];
    for (let i = 0; i < 16; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const speed = 40 + Math.random() * 90;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.7 + Math.random() * 0.6,
        size: 1.4 + Math.random() * 2.2,
        color,
      });
    }
    if (particlesRef.current.length > 160) {
      particlesRef.current.splice(0, particlesRef.current.length - 160);
    }
    wakeRef.current();
  };

  const triggerBurst = (xPercent: number, kind: ReactionKind) => {
    const id = Date.now() + Math.random();
    setBursts((prev) => [...prev.slice(-10), { id, xPercent, kind }]);
    spawnParticles(xPercent, kind);
    const timerId = window.setTimeout(() => {
      burstTimersRef.current.delete(timerId);
      setBursts((prev) => prev.filter((b) => b.id !== id));
    }, 1350);
    burstTimersRef.current.add(timerId);
  };

  // Reactions arriving from other listeners also pop a particle burst.
  useEffect(() => {
    const known = knownMomentIdsRef.current;
    if (known === null) {
      knownMomentIdsRef.current = new Set(moments.map((m) => m.id));
      return;
    }
    for (const m of moments) {
      if (!known.has(m.id)) {
        known.add(m.id);
        const pct = Math.max(2, Math.min(98, (m.timestampSec / safeDuration) * 100));
        spawnParticles(pct, m.reactionType);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moments, safeDuration]);

  // 60 FPS canvas renderer. The loop sleeps when nothing moves (paused, meters at rest, no
  // particles) and is woken by prop changes, so idle timelines cost zero frames.
  useEffect(() => {
    let rafId = 0;
    let running = false;
    let lastFrame = 0;
    let visible = !document.hidden;
    let intersecting = true;
    let colors = readWaveColors();
    let colorsStale = true;
    const meter = new MeterBallistics();

    const frame = (now: number) => {
      rafId = 0;
      const dt = lastFrame ? now - lastFrame : 16.7;
      lastFrame = now;
      const live = liveRef.current;
      const { width: w, height: h, dpr } = live.metrics;
      const canvas = canvasRef.current;
      if (!visible || !intersecting || !canvas || w === 0 || h === 0) {
        running = false;
        lastFrame = 0;
        return;
      }

      // Real playback dynamics -> analog ballistics (10 ms attack, 0.85/frame decay).
      let input = 0;
      if (live.isPlaying) {
        const lv = radioDsp.getStereoLevels();
        if (lv) input = levelToUnit(Math.min(1, Math.max(lv.rmsL, lv.rmsR) * 2.6));
      }
      meter.update(input, now, dt);

      const particles = particlesRef.current;
      const dts = Math.min(0.05, dt / 1000);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dts;
        if (p.age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += 70 * dts;
        p.x += p.vx * dts;
        p.y += p.vy * dts;
      }

      if (colorsStale) {
        colors = readWaveColors();
        colorsStale = false;
      }
      draw(canvas, live, colors, meter.level, particles, now, dpr, w, h);

      const animating = hasMotion() && (live.isPlaying || !meter.isAtRest() || particles.length > 0);
      if (animating) {
        rafId = window.requestAnimationFrame(frame);
      } else {
        running = false;
        lastFrame = 0;
      }
    };

    const wake = () => {
      if (running || !visible || !intersecting) return;
      running = true;
      rafId = window.requestAnimationFrame(frame);
    };
    wakeRef.current = wake;
    const syncVisibility = () => {
      visible = !document.hidden;
      if (visible) {
        wake();
      }
    };
    document.addEventListener('visibilitychange', syncVisibility);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      if (intersecting) {
        wake();
      }
    });
    if (canvasRef.current) {
      visibilityObserver.observe(canvasRef.current);
    }

    // Theme switches change the --wave-* variables on the root element.
    const themeObserver = new MutationObserver(() => {
      colorsStale = true;
      wake();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });

    wake();

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      visibilityObserver.disconnect();
      themeObserver.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
      running = false;
      wakeRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    wakeRef.current();
  }, [canvasMetrics, progressRatio, hoverRatio, isPlaying, bars, heatmap, moments, activeMoment]);

  const [errorText, setErrorText] = useState('');

  const handleQuickReaction = async (kind: ReactionKind) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorText('');
    try {
      const sec = pinnedSec !== null ? pinnedSec : Math.floor(positionSec);
      await onDropMoment(sec, kind, '');
      triggerBurst(Math.max(4, Math.min(96, (sec / safeDuration) * 100)), kind);
      setSelectedKind(kind);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось сохранить отметку.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMomentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorText('');
    try {
      const sec = targetSec;
      const xPct = Math.max(4, Math.min(96, (sec / safeDuration) * 100));
      await onDropMoment(sec, selectedKind, commentText.trim());
      triggerBurst(xPct, selectedKind);
      setCommentText((current) => current === commentText ? '' : current);
      setPinnedSec(null);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось сохранить отметку.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverRatio(ratio);
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const clickedSec = Math.floor(ratio * safeDuration);
    setPinnedSec(clickedSec);
  };


  return (
    <FloatPanel className="glass-double-shell waveform-shell" aria-label="Аудиоволна эфира и реакции на моменты">
      <div className="glass-double-core waveform-core">
        {/* Top Ambient Telemetry Row */}
        <div className="waveform-topline">
          <div className="waveform-topline__left">
            <span className={`pulse-beacon ${isPlaying ? 'is-live' : ''}`}>
              <span className="pulse-beacon__core" />
              <span className="pulse-beacon__ring" />
            </span>
            <span className="waveform-eyebrow">Волна эфира</span>
            <span className="waveform-divider-dot">·</span>
            <span className="waveform-subnote">
              {moments.length} отметок
            </span>
          </div>

          <div className="waveform-topline__right">
            {pinnedSec !== null && (
              <button
                type="button"
                className="waveform-unpin-chip"
                onClick={() => setPinnedSec(null)}
              >
                Выбрано {formatTimecode(pinnedSec)} ×
              </button>
            )}
            <div className="waveform-time-readout">
              <strong className="waveform-time-readout__now">{formatTimecode(displayPosition)}</strong>
              <span className="waveform-time-readout__slash">/</span>
              <span className="waveform-time-readout__total">{formatTimecode(durationSec)}</span>
            </div>
          </div>
        </div>

        {/* Interactive Optical Waveform Stage */}
        <div
          ref={trackRef}
          className="waveform-stage"
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setHoverRatio(null)}
          onClick={handleTrackClick}
          role="slider"
          aria-label="Таймлайн аудиоволны для размещения реакций"
          aria-valuemin={0}
          aria-valuemax={safeDuration}
          aria-valuenow={targetSec}
          aria-valuetext={formatTimecode(targetSec)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              setPinnedSec((prev) =>
                Math.min(safeDuration, (prev ?? Math.floor(positionSec)) + 15)
              );
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setPinnedSec((prev) => Math.max(0, (prev ?? Math.floor(positionSec)) - 15));
            } else if (e.key === 'Escape') {
              setPinnedSec(null);
            }
          }}
        >
          {/* Floating Reaction Particles */}
          <div className="waveform-bursts" aria-hidden="true">
            {bursts.map((b) => (
              <div
                key={b.id}
                className="waveform-burst-item"
                style={{ left: `${b.xPercent}%` }}
              >
                {renderReactionIcon(b.kind, 22)}
              </div>
            ))}
          </div>

          {/* Canvas waveform: 96 bars + mirror reflection, moment halos, particles */}
          <canvas ref={canvasRef} className="waveform-canvas" aria-hidden="true" />
          {bars.length === 0 && <p className="waveform-empty">Волна пока недоступна</p>}

          {/* Sleek Optical Laser Moment Stems (No Discord circles!) */}
          <div className="waveform-stems-layer">
            {moments.slice(-24).map((m) => {
              const pct = Math.max(2, Math.min(98, (m.timestampSec / safeDuration) * 100));
              const isSelected = activeMoment?.id === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`waveform-stem-btn ${isSelected ? 'is-active' : ''}`}
                  style={{ left: `${pct}%` }}
                  title={`${formatTimecode(m.timestampSec)} · @${m.callsign}: ${
                    m.comment || m.reactionType
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedMomentId(m.id);
                    setPinnedSec(m.timestampSec);
                  }}
                >
                  <span className="visually-hidden">
                    {formatTimecode(m.timestampSec)} @{m.callsign}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Live Playhead Optical Beam */}
          {durationSec > 0 && (
            <div
              className="waveform-playhead"
              style={{ left: `clamp(12px, ${progressRatio * 100}%, calc(100% - 12px))` }}
              aria-hidden="true"
            >
              <span
                className="waveform-playhead__badge"
                style={{
                  transform:
                    progressRatio < 0.12
                      ? 'none'
                      : progressRatio > 0.88
                        ? 'translateX(-100%)'
                        : 'translateX(-50%)',
                }}
              >
                Сейчас {formatTimecode(displayPosition)}
              </span>
            </div>
          )}

          {/* Hover Reticle */}
          {hoverRatio !== null && (
            <div
              className="waveform-hover-line"
              style={{ left: `${hoverRatio * 100}%` }}
              aria-hidden="true"
            >
              <span className="waveform-hover-line__time">
                {formatTimecode(hoverRatio * safeDuration)}
              </span>
            </div>
          )}

          {/* Pinned Target Reticle */}
          {pinnedSec !== null && (
            <div
              className="waveform-pinned-line"
              style={{ left: `${(pinnedSec / safeDuration) * 100}%` }}
              aria-hidden="true"
            >
              <span className="waveform-pinned-line__tag">
                {formatTimecode(pinnedSec)}
              </span>
            </div>
          )}
        </div>

        {/* Active Moment Glass Whisper Bar */}
        <div className="waveform-whisper-row">
          {activeMoment ? (
            <div className="waveform-whisper">
              <div className="waveform-whisper__left">
                <span className="waveform-whisper__icon">
                  {renderReactionIcon(activeMoment.reactionType, 16)}
                </span>
                <span className="waveform-whisper__time">
                  {formatTimecode(activeMoment.timestampSec)}
                </span>
                <strong className="waveform-whisper__author">@{activeMoment.callsign}</strong>
                <span className="waveform-whisper__comment">
                  {activeMoment.comment || 'Оставил реакцию'}
                </span>
              </div>
              <button
                type="button"
                className="waveform-whisper__upvote"
                onClick={() => {
                  setErrorText('');
                  void onLikeMoment(activeMoment.id).catch((error) => {
                    setErrorText(
                      error instanceof Error
                        ? error.message
                        : 'Не удалось сохранить отметку.'
                    );
                  });
                }}
              >
                <span>Нравится</span>
                <strong>+{activeMoment.likesCount}</strong>
              </button>
            </div>
          ) : (
            <div className="waveform-whisper waveform-whisper--idle">
              <span>
                Выберите момент на волне, чтобы оставить реакцию или комментарий.
              </span>
            </div>
          )}
        </div>

        {/* Living Glass Reaction Triggers + Inline Moment Stamp Input */}
        <div className="waveform-controls-deck">
          <div className="waveform-reactions-strip" role="group" aria-label="Быстрые реакции на момент сета">
            {REACTION_CATALOG.map((item) => {
              const isSelected = selectedKind === item.kind;
              return (
                <button
                  key={item.kind}
                  type="button"
                  className={`living-reaction-btn ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => handleQuickReaction(item.kind)}
                  title={`${item.label} на ${formatTimecode(targetSec)}`}
                >
                  <span className="living-reaction-btn__icon">
                    {renderReactionIcon(item.kind, 16)}
                  </span>
                  <span className="living-reaction-btn__label">{item.shortLabel}</span>
                </button>
              );
            })}
          </div>

          {errorText && <p role="alert" className="auth-error-box">{errorText}</p>}
          <form className="waveform-stamp-form" onSubmit={handleMomentSubmit}>
            <span className="waveform-stamp-form__time">@{formatTimecode(targetSec)}</span>
            <input
              type="text"
              className="waveform-stamp-form__input"
              aria-label="Комментарий к моменту"
              placeholder="Комментарий к моменту…"
              maxLength={140}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <button
              type="submit"
              className="magnetic-cta magnetic-cta--compact"
              disabled={isSubmitting}
            >
              <span>Отметить</span>
              <span className="magnetic-cta__pod" aria-hidden="true">↗</span>
            </button>
          </form>
        </div>
      </div>
    </FloatPanel>
  );
};
