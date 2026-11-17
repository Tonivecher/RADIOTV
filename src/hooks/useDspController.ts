import { useCallback, useRef, useState } from 'react';
import {
  AudioPreset,
  DspMacroState,
  NEUTRAL_BANDS,
  NEUTRAL_MACROS,
  clampDspMacros,
  clampEqBands,
  clampEqGain,
  radioDsp,
} from '../audio/dspEngine';
import { safeStorage } from '../utils/storage';

const CUSTOM_PRESETS_STORAGE_KEY = 'radiotv_custom_presets';

function loadStoredCustomPresets(): AudioPreset[] {
  try {
    const raw = safeStorage.getItem(CUSTOM_PRESETS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
      .map((p) => ({
        ...p,
        bands: clampEqBands(Array.isArray(p.bands) ? p.bands : []),
        macros: clampDspMacros(p.macros || {}),
      }));
  } catch {
    return [];
  }
}

export function useDspController() {
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [bands, setBands] = useState<number[]>(() => [...NEUTRAL_BANDS]);
  const [macros, setMacros] = useState<DspMacroState>(() => ({
    ...NEUTRAL_MACROS,
    masterGain: 85,
  }));
  const [isDspBypassed, setIsDspBypassed] = useState(true);
  const [customPresets, setCustomPresets] = useState<AudioPreset[]>(loadStoredCustomPresets);

  const bandsRef = useRef(bands);
  bandsRef.current = bands;
  const macrosRef = useRef(macros);
  macrosRef.current = macros;
  const customPresetsRef = useRef(customPresets);
  customPresetsRef.current = customPresets;

  const handleDspBypass = useCallback((bypassed: boolean) => {
    setIsDspBypassed(bypassed);
    radioDsp.setBypass(bypassed);
  }, []);

  const handleResetFlat = useCallback(() => {
    const neutral: DspMacroState = {
      ...NEUTRAL_MACROS,
      masterGain: macrosRef.current.masterGain,
    };
    const neutralBands = [...NEUTRAL_BANDS];
    bandsRef.current = neutralBands;
    macrosRef.current = neutral;
    setActivePresetId('');
    setBands(neutralBands);
    setMacros(neutral);
    radioDsp.setBands(neutralBands);
    radioDsp.setMacros(neutral);
    handleDspBypass(true);
  }, [handleDspBypass]);

  const handleSelectPreset = useCallback(
    (preset: AudioPreset) => {
      if (preset.id === 'flat') {
        handleResetFlat();
        return;
      }
      const nextBands = clampEqBands(preset.bands);
      const nextMacros = clampDspMacros({
        ...preset.macros,
        masterGain: macrosRef.current.masterGain,
      });
      bandsRef.current = nextBands;
      macrosRef.current = nextMacros;
      setActivePresetId(preset.id);
      setBands(nextBands);
      setMacros(nextMacros);
      radioDsp.setBands(nextBands);
      radioDsp.setMacros(nextMacros);
      handleDspBypass(false);
    },
    [handleDspBypass, handleResetFlat]
  );

  const handleBandChange = useCallback(
    (idx: number, gainDb: number) => {
      const gain = clampEqGain(gainDb);
      const nextBands = bandsRef.current.map((value, i) => (i === idx ? gain : value));
      bandsRef.current = nextBands;
      setBands(nextBands);
      setActivePresetId('custom_live');
      radioDsp.setBandGain(idx, gain);
      handleDspBypass(false);
    },
    [handleDspBypass]
  );

  const handleMacroChange = useCallback(
    (patch: Partial<DspMacroState>) => {
      const next = clampDspMacros({ ...macrosRef.current, ...patch });
      macrosRef.current = next;
      setMacros(next);
      radioDsp.setMacros(next);
      if (Object.keys(patch).some((key) => key !== 'masterGain')) {
        setActivePresetId('custom_live');
        handleDspBypass(false);
      }
    },
    [handleDspBypass]
  );

  const handleSaveCustomPreset = useCallback((name: string) => {
    const currentBands = bandsRef.current;
    const currentMacros = macrosRef.current;
    const newPreset: AudioPreset = {
      id: `user_${Date.now()}`,
      name,
      subtitle: 'Пользовательский профиль эквалайзера',
      bands: [...currentBands],
      macros: {
        subBass: currentMacros.subBass,
        warmthDrive: currentMacros.warmthDrive,
        airPresence: currentMacros.airPresence,
        compGlue: currentMacros.compGlue,
      },
      isCustom: true,
    };
    const nextList = [...customPresetsRef.current, newPreset];
    customPresetsRef.current = nextList;
    setCustomPresets(nextList);
    setActivePresetId(newPreset.id);
    safeStorage.setItem(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(nextList));
  }, []);

  return {
    activePresetId,
    bands,
    macros,
    isDspBypassed,
    customPresets,
    handleDspBypass,
    handleResetFlat,
    handleSelectPreset,
    handleBandChange,
    handleMacroChange,
    handleSaveCustomPreset,
  };
}
