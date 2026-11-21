import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AudioPreset,
  BUILTIN_PRESETS,
  DspMacroState,
  EQ_FREQUENCIES,
  EQ_GAIN_LIMIT_DB,
  clampEqBands,
  clampEqGain,
  clampDspMacros,
} from '../audio/dspEngine';
import { MeterBallistics, METER_FLOOR_DB, levelToUnit } from '../audio/meterBallistics';
import { getReactiveAudioEnergy, getReactiveSpectrumBins } from '../audio/reactiveTelemetry';
import { useHiDpiCanvas } from '../utils/hiDpiCanvas';
import { FloatPanel } from './SpatialMotion';
import { TactileDotMatrix } from './TactileDotMatrix';
import { HoldResetButton } from './living/HoldResetButton';
import { RollingNumber } from './living/RollingNumber';

interface DspEqualizerConsoleProps {
  bands: number[];
  macros: DspMacroState;
  activePresetId: string;
  customPresets: AudioPreset[];
  isPlaying?: boolean;
  isBypassed: boolean;
  onChangeBypass: (bypass: boolean) => void;
  onSelectPreset: (preset: AudioPreset) => void;
  onChangeBand: (index: number, gainDb: number) => void;
  onChangeMacro: (patch: Partial<DspMacroState>) => void;
  onSaveCustomPreset: (name: string) => void;
  onResetFlat: () => void;
}

const PRESET_COPY: Record<string, { name: string; subtitle: string }> = {
  flat: { name: 'Ровно', subtitle: 'Без правок' },
  giegling_dub: { name: 'Мягкий низ', subtitle: 'Глубокий бас, спокойный верх' },
  tresor_bunker: { name: 'Плотнее', subtitle: 'Упор на бочку и перкуссию' },
  waking_morning: { name: 'Светлее', subtitle: 'Приоткрыть высокие' },
  nagra_tape: { name: 'Плёнка', subtitle: 'Лёгкий перегруз и плотность' },
  late_night: { name: 'Ночь', subtitle: 'Потише на пиках' },
};

const DB_READOUT_INTERVAL_MS = 80;
const SPECTRUM_INTERVAL_MS = 33;
const TUBE_TICKS = [100, 75, 50, 25, 0] as const;
const MACRO_NOTCHES = Array.from({ length: 11 }, (_, i) => i * 10);

const formatDb = (unit: number): string =>
  unit <= 0 ? '-∞' : (unit * -METER_FLOOR_DB + METER_FLOOR_DB).toFixed(1);

export const DspEqualizerConsole: React.FC<DspEqualizerConsoleProps> = React.memo(({
  bands,
  macros,
  activePresetId,
  customPresets,
  isPlaying = false,
  isBypassed,
  onChangeBypass,
  onSelectPreset,
  onChangeBand,
  onChangeMacro,
  onSaveCustomPreset,
  onResetFlat,
}) => {
  const reducedMotion = Boolean(useReducedMotion());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasMetrics = useHiDpiCanvas(canvasRef);
  const metricsRef = useRef(canvasMetrics);
  metricsRef.current = canvasMetrics;
  const safeBands = clampEqBands(bands);
  const safeMacros = clampDspMacros(macros);
  const bandsRef = useRef(safeBands);
  bandsRef.current = safeBands;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const wakeRef = useRef<() => void>(() => {});
  const fillLRef = useRef<HTMLSpanElement | null>(null);
  const fillRRef = useRef<HTMLSpanElement | null>(null);
  const peakLRef = useRef<HTMLSpanElement | null>(null);
  const peakRRef = useRef<HTMLSpanElement | null>(null);
  const tubePulseRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const ballisticsRef = useRef({ l: new MeterBallistics(), r: new MeterBallistics() });

  const [stereoReadout, setStereoReadout] = useState<{ left: string; right: string }>({
    left: '-∞',
    right: '-∞',
  });
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [showSaveInput, setShowSaveInput] = useState<boolean>(false);

  const allPresets = [
    ...BUILTIN_PRESETS.map((preset) => ({
      ...preset,
      ...(PRESET_COPY[preset.id] || {}),
    })),
    ...customPresets,
  ];
  const currentPreset = allPresets.find((p) => p.id === activePresetId);

  useEffect(() => {
    let rafId = 0;
    let visible = !document.hidden;
    let intersecting = true;
    let lastFrame = performance.now();
    let lastSpectrumDraw = 0;
    let lastReadout = 0;
    let lastText = '';
    const { l: meterL, r: meterR } = ballisticsRef.current;

    const readThemePalette = () => {
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        accentColor: rootStyle.getPropertyValue('--accent-primary').trim() || '#df8078',
        gridColor: rootStyle.getPropertyValue('--hairline').trim() || 'rgba(220,186,180,0.18)',
      };
    };
    let themePalette = readThemePalette();
    let reduceMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduceNow = reduceMotionMedia.matches;
    const onReduceChange = () => {
      reduceNow = reduceMotionMedia.matches;
    };
    reduceMotionMedia.addEventListener('change', onReduceChange);

    const paintMeter = (
      fill: HTMLSpanElement | null,
      peak: HTMLSpanElement | null,
      m: MeterBallistics
    ) => {
      if (fill) fill.style.transform = `scaleX(${m.level.toFixed(4)})`;
      if (peak) {
        peak.style.transform = `translateX(${(m.peak * 100).toFixed(2)}%)`;
        peak.style.opacity = m.peak > 0 ? '1' : '0';
      }
    };

    const renderLoop = (now: number) => {
      rafId = 0;
      if (!visible || !intersecting) return;
      const dt = now - lastFrame;
      lastFrame = now;
      const playing = isPlayingRef.current;
      const nowSec = now * 0.001;

      // --- L/R VU + peak hold (works in both DSP and iOS-safe direct mode) ---
      let inL = 0;
      let inR = 0;
      if (playing) {
        const energy = getReactiveAudioEnergy(nowSec);
        inL = levelToUnit(energy.left);
        inR = levelToUnit(energy.right);
      }
      meterL.update(inL, now, dt);
      meterR.update(inR, now, dt);
      paintMeter(fillLRef.current, peakLRef.current, meterL);
      paintMeter(fillRRef.current, peakRRef.current, meterR);

      if (!reduceNow && (playing || !meterL.isAtRest() || !meterR.isAtRest())) {
        rafId = window.requestAnimationFrame(renderLoop);
      }

      if (now - lastReadout >= DB_READOUT_INTERVAL_MS) {
        lastReadout = now;
        const left = formatDb(meterL.level);
        const right = formatDb(meterR.level);
        const key = `${left}|${right}`;
        if (key !== lastText) {
          lastText = key;
          setStereoReadout({ left, right });
        }
      }

      // Throttle spectrum canvas + tube glow to ~30fps
      if (lastSpectrumDraw && now - lastSpectrumDraw < SPECTRUM_INTERVAL_MS) {
        return;
      }
      lastSpectrumDraw = now;

      // --- Spectrum canvas + live glass tube glow ---
      const bins = getReactiveSpectrumBins(nowSec, playing);
      for (let idx = 0; idx < 10; idx++) {
        const pulseEl = tubePulseRefs.current[idx];
        if (!pulseEl) continue;
        const binIdx = Math.min(bins.length - 1, Math.floor((idx / 10) * bins.length));
        const amp = playing && !reduceNow ? bins[binIdx] || 0 : 0;
        pulseEl.style.opacity = (0.14 + amp * 0.56).toFixed(3);
        pulseEl.style.transform = `scaleY(${(0.22 + amp * 0.78).toFixed(3)})`;
      }

      const canvas = canvasRef.current;
      const { width: w, height: h, dpr } = metricsRef.current;
      if (!canvas || w === 0 || h === 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const { accentColor, gridColor } = themePalette;

      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      for (let row = 1; row <= 3; row++) {
        const y = Math.round((h / 4) * row) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const barCount = bins.length;
      const gap = 3;
      const barWidth = Math.max(1, w / barCount - gap);
      ctx.fillStyle = accentColor;
      for (let i = 0; i < barCount; i++) {
        const val = bins[i] || 0;
        const barHeight = Math.max(4, val * (h - 14));
        const x = i * (barWidth + gap) + gap / 2;
        ctx.globalAlpha = 0.28 + val * 0.55;
        ctx.beginPath();
        ctx.roundRect(x, h - barHeight, barWidth, barHeight, 3);
        ctx.fill();
      }

      const curve = bandsRef.current;
      if (curve.length > 1) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        curve.forEach((db, idx) => {
          const x = (idx / (curve.length - 1)) * (w - 28) + 14;
          const y = h - ((db + EQ_GAIN_LIMIT_DB) / (EQ_GAIN_LIMIT_DB * 2)) * (h - 24) - 12;
          if (idx === 0) {
            ctx.moveTo(x, y);
          } else {
            const prevX = ((idx - 1) / (curve.length - 1)) * (w - 28) + 14;
            const prevY =
              h - ((curve[idx - 1] + EQ_GAIN_LIMIT_DB) / (EQ_GAIN_LIMIT_DB * 2)) * (h - 24) - 12;
            const cpX = (prevX + x) / 2;
            ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
          }
        });
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const wake = () => {
      lastSpectrumDraw = 0;
      if (!rafId && visible && intersecting) {
        rafId = window.requestAnimationFrame(renderLoop);
      }
    };
    wakeRef.current = wake;
    const visibility = () => {
      visible = !document.hidden;
      if (visible) {
        wake();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      if (intersecting) {
        wake();
      }
    });
    if (canvasRef.current) {
      observer.observe(canvasRef.current);
    }
    const themeObserver = new MutationObserver(() => {
      themePalette = readThemePalette();
      wake();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    wake();
    return () => {
      window.cancelAnimationFrame(rafId);
      reduceMotionMedia.removeEventListener('change', onReduceChange);
      observer.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      wakeRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    wakeRef.current();
  }, [bands, isPlaying, canvasMetrics]);

  const handleSavePreset = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPresetName.trim();
    if (!trimmed) return;
    onSaveCustomPreset(trimmed);
    setNewPresetName('');
    setShowSaveInput(false);
  };

  const releaseCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const updateVerticalBandFromClientY = (
    el: HTMLDivElement,
    clientY: number,
    idx: number
  ) => {
    const rect = el.getBoundingClientRect();
    if (!(rect.height > 0)) return;
    const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const rawDb = ratio * EQ_GAIN_LIMIT_DB * 2 - EQ_GAIN_LIMIT_DB;
    const snappedDb = clampEqGain(Math.round(rawDb * 10) / 10);
    onChangeBand(idx, snappedDb);
  };

  const updateHorizontalMacroFromClientX = (
    el: HTMLDivElement,
    clientX: number,
    key: keyof DspMacroState
  ) => {
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChangeMacro({ [key]: Math.round(ratio * 100) });
  };

  const macroDefinitions: Array<{
    key: keyof DspMacroState;
    label: string;
    detail: string;
    value: number;
  }> = [
    {
      key: 'subBass',
      label: 'Бас',
      detail: 'Низкие частоты',
      value: safeMacros.subBass,
    },
    {
      key: 'warmthDrive',
      label: 'Теплота',
      detail: 'Мягкая сатурация',
      value: safeMacros.warmthDrive,
    },
    {
      key: 'airPresence',
      label: 'Воздух',
      detail: 'Высокие частоты',
      value: safeMacros.airPresence,
    },
    {
      key: 'compGlue',
      label: 'Компрессия',
      detail: 'Ровнее по громкости',
      value: safeMacros.compGlue,
    },
  ];

  return (
    <FloatPanel className="glass-double-shell dsp-shell" aria-label="10-полосный эквалайзер и пресеты звучания">
      <TactileDotMatrix />
      <div className="glass-double-core dsp-core">
        {/* Header Row */}
        <div className="dsp-top-bar">
          <div className="dsp-top-bar__titles">
            <span className="section-eyebrow">Эквалайзер</span>
            <h2 className="section-heading">Звук</h2>
            <p className="dsp-active-preset-caption">
              {isBypassed ? (
                'Чистый поток, эквалайзер выключен'
              ) : currentPreset ? (
                <>
                  Профиль: <strong>{currentPreset.name}</strong> · {currentPreset.subtitle}
                </>
              ) : (
                'Своя кривая · диапазон ±2 дБ'
              )}
            </p>
          </div>

          <div className="dsp-top-bar__actions">
            <button
              type="button"
              className={`glass-pill-btn dsp-bypass-switch button-circle button-circle--eq ${!isBypassed ? 'is-engaged' : ''}`}
              aria-pressed={!isBypassed}
              onClick={() => onChangeBypass(!isBypassed)}
            >
              <span className="button-circle__icon-wrap dsp-bypass-switch__orb" aria-hidden="true">
                <span className="button-circle__base-icon">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M8 2v5" />
                    <path d="M4.6 4.4a5 5 0 1 0 6.8 0" />
                  </svg>
                </span>
                <span className="button-circle__mask-icon">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                    <path d="M8 2v5" />
                    <path d="M4.6 4.4a5 5 0 1 0 6.8 0" />
                  </svg>
                </span>
              </span>
              <span className="dsp-bypass-switch__track" aria-hidden="true">
                <motion.span
                  className="dsp-bypass-switch__thumb"
                  animate={{ x: !isBypassed ? 12 : 0 }}
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 520, damping: 32 }
                  }
                />
              </span>
              <span>{isBypassed ? 'Без обработки' : 'Обработка включена'}</span>
            </button>
            <HoldResetButton onConfirm={onResetFlat} />
          </div>
        </div>

        {/* Fluid Segmented Glass Preset Bar with spring-gliding active pill */}
        <div className="dsp-presets-bar-wrap">
          <div className="dsp-segmented-presets" role="radiogroup" aria-label="Профили звука">
            {allPresets.map((preset) => {
              const isSelected = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`dsp-segment-btn ${isSelected ? 'is-active' : ''}`}
                  onClick={() => onSelectPreset(preset)}
                  title={preset.subtitle}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="dsp-preset-pill"
                      className="dsp-segment-btn__pill"
                      transition={
                        reducedMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 440, damping: 34 }
                      }
                      aria-hidden="true"
                    />
                  )}
                  <span className="dsp-segment-btn__label">{preset.name}</span>
                </button>
              );
            })}
          </div>

          {!showSaveInput ? (
            <button
              type="button"
              className="glass-pill-btn"
              onClick={() => setShowSaveInput(true)}
            >
              <span>+ Свой профиль</span>
            </button>
          ) : (
            <form className="dsp-save-inline" onSubmit={handleSavePreset}>
              <input
                type="text"
                className="dsp-save-inline__input"
                placeholder="Название профиля"
                maxLength={22}
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
              />
              <button type="submit" className="glass-pill-btn is-engaged">
                <span>Сохранить</span>
              </button>
              <button
                type="button"
                className="glass-pill-btn"
                onClick={() => setShowSaveInput(false)}
              >
                <span>Отмена</span>
              </button>
            </form>
          )}
        </div>

        {/* Open Two-Column Studio Workspace: 10 Optical Liquid-Glass Tube Faders + Spectrum & Detent Macros */}
        <div className="dsp-studio-matrix">
          <div className="dsp-faders-wrap">
            <div className="dsp-scale-legend num-tabular" aria-hidden="true">
              <span>+2 dB</span>
              <span>0 dB</span>
              <span>−2 dB</span>
            </div>

            <div className="dsp-faders-stage" aria-label="10 частотных полос эквалайзера">
              {EQ_FREQUENCIES.map((cfg, idx) => {
                const val = safeBands[idx];
                const fillPct = ((val + EQ_GAIN_LIMIT_DB) / (EQ_GAIN_LIMIT_DB * 2)) * 100;
                const isBoost = val > 0.1;
                const isCut = val < -0.1;
                const dbStr = val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1);

                return (
                  <div key={cfg.freq} className="dsp-fader-column">
                    <span
                      className={`dsp-fader-column__db num-tabular ${
                        isBoost ? 'is-boost' : isCut ? 'is-cut' : ''
                      }`}
                    >
                      {dbStr}
                    </span>

                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label={`Частота ${cfg.label} Гц`}
                      aria-valuemin={-EQ_GAIN_LIMIT_DB}
                      aria-valuemax={EQ_GAIN_LIMIT_DB}
                      aria-valuenow={val}
                      aria-valuetext={`${val > 0 ? '+' : ''}${val.toFixed(1)} дБ`}
                      aria-orientation="vertical"
                      className={`dsp-glass-fader-track ${
                        isBoost ? 'is-boost' : isCut ? 'is-cut' : ''
                      }`}
                      title="Перетащите для настройки. Двойной щелчок сбрасывает полосу."
                      onDoubleClick={() => onChangeBand(idx, 0)}
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        updateVerticalBandFromClientY(e.currentTarget, e.clientY, idx);
                      }}
                      onPointerMove={(e) => {
                        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                        updateVerticalBandFromClientY(e.currentTarget, e.clientY, idx);
                      }}
                      onPointerUp={releaseCapture}
                      onPointerCancel={releaseCapture}
                      onLostPointerCapture={releaseCapture}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          onChangeBand(idx, clampEqGain(Math.round((val + 0.1) * 10) / 10));
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          onChangeBand(idx, clampEqGain(Math.round((val - 0.1) * 10) / 10));
                        } else if (e.key === 'Home' || e.key === 'End') {
                          e.preventDefault();
                          onChangeBand(
                            idx,
                            e.key === 'Home' ? -EQ_GAIN_LIMIT_DB : EQ_GAIN_LIMIT_DB
                          );
                        }
                      }}
                    >
                      {/* Transparent optical glass cylinder wall + specular highlight */}
                      <span className="dsp-glass-tube" aria-hidden="true">
                        <span className="dsp-glass-tube__glint" />
                        <span
                          ref={(el) => {
                            tubePulseRefs.current[idx] = el;
                          }}
                          className="dsp-glass-tube__pulse"
                        />
                        <span
                          className="dsp-glass-fader-track__fill"
                          style={{ height: `${fillPct}%` }}
                        >
                          <span className="dsp-glass-tube__meniscus" />
                        </span>
                        <span className="dsp-glass-tube__ticks">
                          {TUBE_TICKS.map((tickPct) => (
                            <i
                              key={tickPct}
                              className={tickPct === 50 ? 'is-zero' : undefined}
                              style={{ bottom: `${tickPct}%` }}
                            />
                          ))}
                        </span>
                      </span>
                      <span className="dsp-glass-fader-track__zero" aria-hidden="true" />
                      <span
                        className="dsp-glass-fader-track__cap"
                        style={{ bottom: `calc(${fillPct}% - 8px)` }}
                        aria-hidden="true"
                      />
                    </div>

                    <span className="dsp-fader-column__freq num-tabular">{cfg.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Live FFT Spectrum Lens + Stereo Peak Ribbon + 4 Graduated Detent Macro Controls */}
          <div className="dsp-side-rack">
            <div className="dsp-spectrum-lens">
              <div className="dsp-spectrum-lens__head num-tabular">
                <span>Спектр · 32 Гц – 16 кГц</span>
                <span className="dsp-stereo-db num-tabular">
                  L {stereoReadout.left} dB · R {stereoReadout.right} dB
                </span>
              </div>
              <canvas ref={canvasRef} className="dsp-spectrum-canvas" />
              <div className="dsp-stereo-bars" aria-hidden="true">
                <div className="dsp-stereo-bar">
                  <span ref={fillLRef} className="dsp-stereo-bar__fill" />
                  <span ref={peakLRef} className="dsp-stereo-bar__peak" />
                </div>
                <div className="dsp-stereo-bar">
                  <span ref={fillRRef} className="dsp-stereo-bar__fill" />
                  <span ref={peakRRef} className="dsp-stereo-bar__peak" />
                </div>
              </div>
            </div>

            {/* 4 Graduated Optical Detent Macro Scales */}
            <div className="dsp-macros-list">
              {macroDefinitions.map((m) => (
                <div key={m.key} className="dsp-macro-item">
                  <div className="dsp-macro-item__meta">
                    <div>
                      <strong className="dsp-macro-item__label">{m.label}</strong>
                      <span className="dsp-macro-item__detail">{m.detail}</span>
                    </div>
                    <span className="dsp-macro-item__val">
                      <RollingNumber value={`${m.value}%`} />
                    </span>
                  </div>

                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={m.label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={m.value}
                    className="dsp-macro-ribbon"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      updateHorizontalMacroFromClientX(e.currentTarget, e.clientX, m.key);
                    }}
                    onPointerMove={(e) => {
                      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                      updateHorizontalMacroFromClientX(e.currentTarget, e.clientX, m.key);
                    }}
                    onPointerUp={releaseCapture}
                    onPointerCancel={releaseCapture}
                    onLostPointerCapture={releaseCapture}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        onChangeMacro({ [m.key]: Math.min(100, m.value + 5) });
                      } else if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        onChangeMacro({ [m.key]: Math.max(0, m.value - 5) });
                      }
                    }}
                  >
                    <span className="dsp-macro-detents" aria-hidden="true">
                      {MACRO_NOTCHES.map((notch) => {
                        const isLit = notch <= m.value;
                        const dist = Math.abs(notch - m.value);
                        const isNear = dist <= 12;
                        return (
                          <i
                            key={notch}
                            className={`dsp-macro-detent${isLit ? ' is-lit' : ''}${
                              isNear ? ' is-near' : ''
                            }${notch === 0 || notch === 50 || notch === 100 ? ' is-anchor' : ''}`}
                          />
                        );
                      })}
                    </span>
                    <span
                      className="dsp-macro-ribbon__fill"
                      style={{ width: `${m.value}%` }}
                      aria-hidden="true"
                    />
                    <span
                      className="dsp-macro-ribbon__thumb"
                      style={{ left: `calc(${m.value}% - 8px)` }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </FloatPanel>
  );
});
