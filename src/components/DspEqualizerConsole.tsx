import { FloatPanel } from './SpatialMotion';
import React, { useEffect, useRef, useState } from 'react';
import {
  AudioPreset,
  BUILTIN_PRESETS,
  DspMacroState,
  EQ_FREQUENCIES,
  EQ_GAIN_LIMIT_DB,
  clampEqBands,
  clampEqGain,
  clampDspMacros,
  radioDsp,
} from '../audio/dspEngine';
import { MeterBallistics, METER_FLOOR_DB, levelToUnit } from '../audio/meterBallistics';
import { useHiDpiCanvas } from '../utils/hiDpiCanvas';

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
  flat: { name: 'Без окраски', subtitle: 'Ровный баланс частот' },
  giegling_dub: { name: 'Мягкий бас', subtitle: 'Глубокие низкие частоты и спокойная середина' },
  tresor_bunker: { name: 'Плотный ритм', subtitle: 'Больше баса и перкуссии' },
  waking_morning: { name: 'Воздух', subtitle: 'Светлее на высоких частотах' },
  nagra_tape: { name: 'Теплее', subtitle: 'Насыщенный тембр и мягкая компрессия' },
  late_night: { name: 'Тихий вечер', subtitle: 'Мягкий баланс без резких пиков' },
};

/** Display gain applied to raw RMS, matches getSpectrumAndMeters(). */
const METER_DISPLAY_GAIN = 2.6;
const DB_READOUT_INTERVAL_MS = 66;

const formatDb = (unit: number): string =>
  unit <= 0 ? '-∞' : (unit * -METER_FLOOR_DB + METER_FLOOR_DB).toFixed(1);

export const DspEqualizerConsole: React.FC<DspEqualizerConsoleProps> = ({
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
  const ballisticsRef = useRef({ l: new MeterBallistics(), r: new MeterBallistics() });

  const [stereoReadout, setStereoReadout] = useState<{ left: string; right: string }>({
    left: '-∞',
    right: '-∞',
  });
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [showSaveInput, setShowSaveInput] = useState<boolean>(false);

  const allPresets = [...BUILTIN_PRESETS.map((preset) => ({ ...preset, ...(PRESET_COPY[preset.id] || {}) })), ...customPresets];
  const currentPreset = allPresets.find((p) => p.id === activePresetId);

  useEffect(() => {
    let rafId = 0;
    let visible = !document.hidden;
    let intersecting = true;
    let lastFrame = performance.now();
    let lastReadout = 0;
    let lastText = '';
    const { l: meterL, r: meterR } = ballisticsRef.current;

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

      // --- L/R VU + peak hold ---
      let inL = 0;
      let inR = 0;
      if (playing) {
        const levels = radioDsp.getStereoLevels();
        if (levels) {
          inL = levelToUnit(Math.min(1, levels.rmsL * METER_DISPLAY_GAIN));
          inR = levelToUnit(Math.min(1, levels.rmsR * METER_DISPLAY_GAIN));
        }
      }
      meterL.update(inL, now, dt);
      meterR.update(inR, now, dt);
      paintMeter(fillLRef.current, peakLRef.current, meterL);
      paintMeter(fillRRef.current, peakRRef.current, meterR);
      if (playing || !meterL.isAtRest() || !meterR.isAtRest()) rafId = window.requestAnimationFrame(renderLoop);

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

      // --- Spectrum canvas (CSS-pixel coordinates, DPR via transform) ---
      const canvas = canvasRef.current;
      const { width: w, height: h, dpr } = metricsRef.current;
      if (!canvas || w === 0 || h === 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const rootStyle = getComputedStyle(document.documentElement);
      const accentColor = rootStyle.getPropertyValue('--accent-primary').trim() || '#38bdf8';
      const gridColor = rootStyle.getPropertyValue('--hairline').trim() || 'rgba(148,163,184,0.16)';

      // Subtle horizontal reference lines (half-pixel offset keeps 1px lines crisp)
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      for (let row = 1; row <= 3; row++) {
        const y = Math.round((h / 4) * row) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 32 FFT spectrum bars (flat floor when paused)
      const telemetry = radioDsp.getSpectrumAndMeters(playing);
      const bins = telemetry.bins;
      const barCount = bins.length;
      const gap = 3;
      const barWidth = Math.max(1, w / barCount - gap);
      ctx.fillStyle = accentColor;
      for (let i = 0; i < barCount; i++) {
        const val = bins[i] || 0;
        const barHeight = Math.max(4, val * (h - 14));
        const x = i * (barWidth + gap) + gap / 2;
        ctx.globalAlpha = 0.22 + val * 0.48;
        ctx.beginPath();
        ctx.roundRect(x, h - barHeight, barWidth, barHeight, 3);
        ctx.fill();
      }

      // Smooth spline EQ response curve overlay
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
            const prevY = h - ((curve[idx - 1] + EQ_GAIN_LIMIT_DB) / (EQ_GAIN_LIMIT_DB * 2)) * (h - 24) - 12;
            const cpX = (prevX + x) / 2;
            ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
          }
        });
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2.25;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const wake = () => { if (!rafId && visible && intersecting) rafId = window.requestAnimationFrame(renderLoop); };
    wakeRef.current = wake;
    const visibility = () => { visible = !document.hidden; if (visible) wake(); };
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; if (intersecting) wake(); });
    if (canvasRef.current) observer.observe(canvasRef.current);
    const themeObserver = new MutationObserver(wake);
    themeObserver.observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
    wake();
    return () => { window.cancelAnimationFrame(rafId); observer.disconnect(); themeObserver.disconnect(); document.removeEventListener('visibilitychange', visibility); wakeRef.current = () => {}; };
  }, []);


  useEffect(() => { wakeRef.current(); }, [bands, isPlaying, canvasMetrics]);

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

  // Direct manipulation 1:1 vertical fader helper (Apple Fluid Interfaces pattern)
  const updateVerticalBandFromClientY = (
    el: HTMLDivElement,
    clientY: number,
    idx: number
  ) => {
    const rect = el.getBoundingClientRect();
    const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const rawDb = ratio * EQ_GAIN_LIMIT_DB * 2 - EQ_GAIN_LIMIT_DB;
    const snappedDb = clampEqGain(Math.round(rawDb * 10) / 10);
    onChangeBand(idx, snappedDb);
  };

  // Direct manipulation 1:1 horizontal ribbon helper
  const updateHorizontalMacroFromClientX = (
    el: HTMLDivElement,
    clientX: number,
    key: keyof DspMacroState
  ) => {
    const rect = el.getBoundingClientRect();
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
      <div className="glass-double-core dsp-core">
        {/* Header Row */}
        <div className="dsp-top-bar">
          <div className="dsp-top-bar__titles">
            <span className="section-eyebrow">Звук под себя</span>
            <h2 className="section-heading">Настройте звук</h2>
            <p className="dsp-active-preset-caption">
              {isBypassed ? 'Оригинальный звук · обработка выключена' : currentPreset
                ? <>Профиль: <strong>{currentPreset.name}</strong> · {currentPreset.subtitle}</>
                : 'Ручная настройка · диапазон ±2 дБ'}
            </p>
          </div>

          <div className="dsp-top-bar__actions">
            <button
              type="button"
              className={`glass-pill-btn ${!isBypassed ? 'is-engaged' : ''}`}
              aria-pressed={!isBypassed}
              onClick={() => onChangeBypass(!isBypassed)}
            >
              <span className="glass-pill-btn__dot" />
              <span>{isBypassed ? 'Без обработки' : 'Обработка включена'}</span>
            </button>
            <button
              type="button"
              className="glass-pill-btn"
              onClick={onResetFlat}
            >
              <span>Сбросить</span>
            </button>
          </div>
        </div>

        {/* Fluid Segmented Glass Preset Bar */}
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
                  <span>{preset.name}</span>
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

        {/* Open Two-Column Studio Workspace: 10 Custom Glass Light-Pillar Faders + Spectrum & Macros */}
        <div className="dsp-studio-matrix">
          {/* Left: 10 Custom Pointer-Captured Glass Light-Pillar Faders (Zero browser range inputs!) */}
          <div className="dsp-faders-stage" aria-label="10 частотных полос эквалайзера">
            {EQ_FREQUENCIES.map((cfg, idx) => {
              const val = safeBands[idx];
              const fillPct = ((val + EQ_GAIN_LIMIT_DB) / (EQ_GAIN_LIMIT_DB * 2)) * 100;
              const isBoost = val > 0.1;
              const isCut = val < -0.1;

              return (
                <div key={cfg.freq} className="dsp-fader-column">
                  <span
                    className={`dsp-fader-column__db ${
                      isBoost ? 'is-boost' : isCut ? 'is-cut' : ''
                    }`}
                  >
                    {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)}
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
                    className="dsp-glass-fader-track"
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
                        onChangeBand(idx, e.key === 'Home' ? -EQ_GAIN_LIMIT_DB : EQ_GAIN_LIMIT_DB);
                      }
                    }}
                  >
                    <span className="dsp-glass-fader-track__zero" />
                    <span
                      className="dsp-glass-fader-track__fill"
                      style={{ height: `${fillPct}%` }}
                    />
                    <span
                      className="dsp-glass-fader-track__cap"
                      style={{ bottom: `calc(${fillPct}% - 7px)` }}
                    />
                  </div>

                  <span className="dsp-fader-column__freq">{cfg.label}</span>
                </div>
              );
            })}
          </div>

          {/* Right: Live FFT Spectrum Lens + Stereo Peak Ribbon + 4 Custom Glass Macro Ribbons */}
          <div className="dsp-side-rack">
            <div className="dsp-spectrum-lens">
              <div className="dsp-spectrum-lens__head">
                <span>Спектр · 32 Гц – 16 кГц</span>
                <span className="dsp-stereo-db">
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

            {/* 4 Custom Glass Macro Ribbons */}
            <div className="dsp-macros-list">
              {macroDefinitions.map((m) => (
                <div key={m.key} className="dsp-macro-item">
                  <div className="dsp-macro-item__meta">
                    <div>
                      <strong className="dsp-macro-item__label">{m.label}</strong>
                      <span className="dsp-macro-item__detail">{m.detail}</span>
                    </div>
                    <span className="dsp-macro-item__val">{m.value}%</span>
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
                    <span
                      className="dsp-macro-ribbon__fill"
                      style={{ width: `${m.value}%` }}
                    />
                    <span
                      className="dsp-macro-ribbon__thumb"
                      style={{ left: `calc(${m.value}% - 7px)` }}
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
};
