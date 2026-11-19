import { AsciiChannelProfile } from '../constants/ascii';

const MAP_WIDTH = 96;
const MAP_HEIGHT = 48;

// 96x48 equirectangular world map (lon -180..+180, lat +90..-90).
// '~' ocean, '.' coastal shallows, '#' forest/plains, '^' mountains/plateaus, '*' polar ice.
const WORLD_MAP_ROWS: readonly string[] = [
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~**~~~~~~*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*****~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~***~~~~~~~~~~~~~~********~~~~~~~**~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~*****~*****~~~~~~~~~~~*********~~~~~~~*****~~~~~~~~***********~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~***************~~~~~~~***********~~~~~~********~~~********************~~~~~~~~~~~~~~~~~~~',
  '~~~~~******************~~~~~**********~~~~~~~~~****************************^***~~~~~~~~~~~~~~~~~',
  '~~~~.###################~~~.#########~~~~~~~.##^############################^^^##.~~~~~~~~~~~~~~',
  '~~~.##^^################~.#####..###~~~~~~..###^^^#########################^^^^###.~~~~~~~~~~~~~',
  '~~~.###^^################~######~~~~~~~~~~.####^^^^###########################^^###~~~~~~~~~~~~~',
  '~~~~.###^^###############~~#####~~~~~~~~~~.####^^^############################^^^##.~~~~~~~~~~~~',
  '~~~~~.###^^###############~####~~~~~~~~~~~.####^^^#####################^######^^###~~~~~~~~~~~~~',
  '~~~~~~.###^^##############~##~~~~~~~~~~~~~.######^##########^^^#######^^^#########.~~~~##~~~~~~~',
  '~~~~~~~.###^^#############~~~~~~~~~~~~~~~~.################^^^^^######^^^########~~~~~.###~~~~~~',
  '~~~~~~~~.###^^###########~~~~~~~~~~~~~~~~~~.#####~#########^^^^^^#####^^^#######~~~~~~.##~~~~~~~',
  '~~~~~~~~~.###^^#########.~~~~~~~~~~~~~~~~~~~####~~~########^^^^^^^######^^#####~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~.####^#######.~~~~~~~~~~~~~~~~~~~~~###~~~.#######^^^^^^^######^#####~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~.####^#####.~~~~~~~~~~~~~~~~~~~~~~.~..~~.########^^^^^^#####^#####~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~.####^###.~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~..#####.######^#####^###~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~.######~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~.#######.#####^^####.###~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~.####~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~.#########~####^^###~~.#~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~.###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~.###########~####^##.~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~.###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~.############~~###^#.~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~.###.~~~~~~~~~~~~~~~~~~~~~~~~~~~.############~~.##^.~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~.####.~~~~~~~~~~~~~~~~~~~~~~~~~.#######^####~~~.##~~~~~..~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~..###~~~~~~~~~~~~~~~~~~~~~~~~~~.######^^##.~~~~~~~~~~.##.###.~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~.###.~~~~~~~~~~~~~~~~~~~~~~~~~~.#####^^##~~~~~~~~~~~.###~##~.###~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~.#####~~~~~~~~~~~~~~~~~~~~~~~~~~.####^^##~~~~~~~~~~~~~~~~~..~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~.#######.~~~~~~~~~~~~~~~~~~~~~~~~~.####^^#.~~~~~~~~~~~~~~~~~~~~~~~~.####~~~~~',
  '~~~~~~~~~~~~~~~~~~.#########~~~~~~~~~~~~~~~~~~~~~~~~~~.###^^#.~~~~~~~~~~~~~~~~~~~~~~~.#######.~~',
  '~~~~~~~~~~~~~~~~~~.###^^#####.~~~~~~~~~~~~~~~~~~~~~~~~~.##^^#~~~~~~~~~~~~~~~~~~~~~~~.#########.~',
  '~~~~~~~~~~~~~~~~~~.###^^#####~~~~~~~~~~~~~~~~~~~~~~~~~~.##^#.~~#~~~~~~~~~~~~~~~~~~~~.#########~~',
  '~~~~~~~~~~~~~~~~~~~.##^^#####~~~~~~~~~~~~~~~~~~~~~~~~~~~.##^.~~#~~~~~~~~~~~~~~~~~~~~.##^^^####.~',
  '~~~~~~~~~~~~~~~~~~~.##^^####.~~~~~~~~~~~~~~~~~~~~~~~~~~~.###~~~~~~~~~~~~~~~~~~~~~~~~~.####^###.~',
  '~~~~~~~~~~~~~~~~~~~~.##^####~~~~~~~~~~~~~~~~~~~~~~~~~~~~~.#~~~~~~~~~~~~~~~~~~~~~~~~~~~.###.###~~',
  '~~~~~~~~~~~~~~~~~~~~.##^###.~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~.~..~##~~',
  '~~~~~~~~~~~~~~~~~~~~.##^^#.~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~#~~~',
  '~~~~~~~~~~~~~~~~~~~~~.#^#.~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~.#^#.~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~.##~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~******~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~********************************************~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~*******************************************************************~~~~~~~~~~~~~~~',
  '************************************************************************************************',
];

const enum TerrainCode {
  Ocean = 0,
  Shallows = 1,
  Land = 2,
  Highland = 3,
  Ice = 4,
}

const TERRAIN_GRID = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);

for (let y = 0; y < MAP_HEIGHT; y++) {
  const row = (WORLD_MAP_ROWS[y] || '').padEnd(MAP_WIDTH, '~');
  for (let x = 0; x < MAP_WIDTH; x++) {
    const ch = row[x];
    let code = TerrainCode.Ocean;
    if (ch === '.') code = TerrainCode.Shallows;
    else if (ch === '#') code = TerrainCode.Land;
    else if (ch === '^') code = TerrainCode.Highland;
    else if (ch === '*') code = TerrainCode.Ice;
    TERRAIN_GRID[y * MAP_WIDTH + x] = code;
  }
}

interface GlobePalette {
  oceanDeep: [number, number, number];
  oceanLit: [number, number, number];
  shallows: [number, number, number];
  forest: [number, number, number];
  savanna: [number, number, number];
  highland: [number, number, number];
  clouds: [number, number, number];
  cityLight: [number, number, number];
  atmosphere: [number, number, number];
  shadowTint: [number, number, number];
}

// Minecraft-rich biome tones gently glazed with each channel's sky mood so they harmonize natively.
const GLOBE_PALETTE_MAIN: GlobePalette = {
  oceanDeep: [18, 62, 146],
  oceanLit: [34, 154, 240],
  shallows: [45, 224, 200],
  forest: [42, 202, 92],
  savanna: [152, 214, 58],
  highland: [232, 132, 54],
  clouds: [223, 211, 192],
  cityLight: [244, 208, 84],
  atmosphere: [122, 206, 255],
  shadowTint: [26, 22, 18],
};

const GLOBE_PALETTE_DEEP: GlobePalette = {
  oceanDeep: [56, 20, 28],
  oceanLit: [158, 66, 70],
  shallows: [212, 122, 112],
  forest: [138, 86, 72],
  savanna: [198, 134, 96],
  highland: [224, 152, 118],
  clouds: [232, 212, 206],
  cityLight: [236, 186, 132],
  atmosphere: [223, 128, 120],
  shadowTint: [22, 10, 13],
};

const GLOBE_PALETTE_DEEPTECH: GlobePalette = {
  oceanDeep: [38, 34, 114],
  oceanLit: [94, 112, 244],
  shallows: [45, 224, 198],
  forest: [44, 214, 162],
  savanna: [182, 152, 244],
  highland: [240, 168, 112],
  clouds: [207, 196, 230],
  cityLight: [244, 191, 48],
  atmosphere: [177, 156, 232],
  shadowTint: [20, 16, 29],
};

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const parsed = Number.parseInt(clean, 16);
  if (!Number.isFinite(parsed)) return [231, 187, 148];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function interpolatePalette(a: GlobePalette, b: GlobePalette, t: number): GlobePalette {
  return {
    oceanDeep: lerpRgb(a.oceanDeep, b.oceanDeep, t),
    oceanLit: lerpRgb(a.oceanLit, b.oceanLit, t),
    shallows: lerpRgb(a.shallows, b.shallows, t),
    forest: lerpRgb(a.forest, b.forest, t),
    savanna: lerpRgb(a.savanna, b.savanna, t),
    highland: lerpRgb(a.highland, b.highland, t),
    clouds: lerpRgb(a.clouds, b.clouds, t),
    cityLight: lerpRgb(a.cityLight, b.cityLight, t),
    atmosphere: lerpRgb(a.atmosphere, b.atmosphere, t),
    shadowTint: lerpRgb(a.shadowTint, b.shadowTint, t),
  };
}

function resolveGlobePalette(profile: AsciiChannelProfile): GlobePalette {
  const [tr, tg, tb] = parseHexRgb(profile.tintHex);
  const deepProximity = Math.max(0, 1 - Math.hypot(tr - 94, tg - 34, tb - 40) / 140);
  const techProximity = Math.max(0, 1 - Math.hypot(tr - 79, tg - 61, tb - 130) / 140);
  const total = deepProximity + techProximity;

  if (profile.asciiMix < 0.16 && total < 0.35) {
    return GLOBE_PALETTE_MAIN;
  }

  const target =
    total > 0.01
      ? interpolatePalette(
          GLOBE_PALETTE_DEEP,
          GLOBE_PALETTE_DEEPTECH,
          clamp01(techProximity / total)
        )
      : GLOBE_PALETTE_MAIN;

  const mixAmt = clamp01((profile.duotoneMix - 0.08) / 0.8);
  return interpolatePalette(GLOBE_PALETTE_MAIN, target, mixAmt);
}

function sampleTerrain(latRad: number, lonRad: number): TerrainCode {
  const rippleLon = lonRad + Math.sin(latRad * 9) * 0.026;
  const rippleLat = latRad + Math.cos(lonRad * 11) * 0.02;
  const u = ((rippleLon / (Math.PI * 2) + 0.5) % 1 + 1) % 1;
  const v = clamp01(0.5 - rippleLat / Math.PI);
  const gx = Math.min(MAP_WIDTH - 1, Math.floor(u * MAP_WIDTH));
  const gy = Math.min(MAP_HEIGHT - 1, Math.floor(v * MAP_HEIGHT));
  return TERRAIN_GRID[gy * MAP_WIDTH + gx] as TerrainCode;
}

function sampleCloudSwirl(latRad: number, lonRad: number): number {
  const cycloneA =
    Math.sin(lonRad * 2.7 + Math.sin(latRad * 4.2) * 2.1) *
    Math.cos(latRad * 4.8 - Math.cos(lonRad * 2.3) * 1.4);
  const cycloneB = Math.sin(lonRad * 6.1 + latRad * 3.6) * 0.34;
  return cycloneA * 0.72 + cycloneB;
}

export interface AsciiGlobeRenderOptions {
  width: number;
  height: number;
  overscanTopPx?: number;
  timeSec: number;
  profile: AsciiChannelProfile;
  pixels: Uint8ClampedArray;
  sampleCols: number;
  sampleRows: number;
  scale: number;
  animate: boolean;
  glitchStrength?: number;
  audioLevel?: number;
  pointerX?: number;
  pointerY?: number;
}

const AXIAL_TILT_RAD = (23.4 * Math.PI) / 180;
const COS_TILT = Math.cos(AXIAL_TILT_RAD);
const SIN_TILT = Math.sin(AXIAL_TILT_RAD);
const PITCH_RAD = 0.2;
const COS_PITCH = Math.cos(PITCH_RAD);
const SIN_PITCH = Math.sin(PITCH_RAD);

// Matches upper-left sunset light source.
const LIGHT_X = -0.58;
const LIGHT_Y = 0.42;
const LIGHT_Z = 0.7;

interface StarSpec {
  u: number;
  v: number;
  glyph: string;
  phase: number;
}

const COSMOS_STARS: readonly StarSpec[] = Array.from({ length: 44 }, (_, i) => {
  const s1 = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  const s2 = Math.sin(i * 39.3468 + 11.135) * 24634.6345;
  const r1 = s1 - Math.floor(s1);
  const r2 = s2 - Math.floor(s2);
  const glyphs = ['·', '+', '*', '·', ':'];
  return {
    u: 0.16 + r1 * 0.68,
    v: 0.04 + r2 * 0.24,
    glyph: glyphs[i % glyphs.length],
    phase: i * 0.9,
  };
});

const rgbaCache = new Map<number, string>();

const MAX_CHANNEL_BRIGHTNESS = 232;

function cachedRgba(r: number, g: number, b: number, a = 1): string {
  const rq = Math.max(0, Math.min(MAX_CHANNEL_BRIGHTNESS, Math.round(r / 4) * 4));
  const gq = Math.max(0, Math.min(MAX_CHANNEL_BRIGHTNESS, Math.round(g / 4) * 4));
  const bq = Math.max(0, Math.min(MAX_CHANNEL_BRIGHTNESS, Math.round(b / 4) * 4));
  const aq = Math.max(0, Math.min(31, Math.round(clamp01(a) * 31)));
  const key = (rq << 21) | (gq << 13) | (bq << 5) | aq;
  let str = rgbaCache.get(key);
  if (!str) {
    str =
      aq >= 31
        ? `rgb(${rq},${gq},${bq})`
        : `rgba(${rq},${gq},${bq},${(aq / 31).toFixed(2)})`;
    if (rgbaCache.size > 6144) rgbaCache.clear();
    rgbaCache.set(key, str);
  }
  return str;
}

// ───────────────────────── Ball Lightning Autonomous Physics & Mouse Grab ─────────────────────────

interface PlasmaSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  glyph: string;
  bornSec: number;
  lifeSec: number;
}

type BallLightningMode = 'levitate' | 'wander' | 'dart' | 'flung';

const SPARK_GLYPHS = ['⚡', '*', '+', '#', '∆', '░', ':'];

const ballState = {
  u: 0.74,
  v: 0.22,
  vu: -0.04,
  vv: 0.015,
  targetU: 0.26,
  targetV: 0.28,
  curlSign: 1,
  mode: 'wander' as BallLightningMode,
  nextDecisionSec: 0,
  lastStepSec: 0,
  spinAngle: 1.1,
  spinSpeed: 0.48,
  charge: 0.25,
  shockwaveBornSec: -10,
  shockwaveX: 0,
  shockwaveY: 0,
  isDragging: false,
  isHovered: false,
  pointerId: -1,
  downClientX: 0,
  downClientY: 0,
  downTimeMs: 0,
  dragTargetU: 0.74,
  dragTargetV: 0.22,
  lastPointerClientX: -9999,
  lastPointerClientY: -9999,
  lastMoveMs: 0,
  screenCx: 0,
  screenCy: 0,
  screenRadius: 64,
  viewportW: 1440,
  viewportH: 900,
  overscanPx: 44,
  sparks: [] as PlasmaSpark[],
};

function pseudoNoise(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function isInteractiveUiElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, label, [role="slider"], [role="button"], [role="radio"], [role="tab"], .island-header-shell, .floating-mini-dock, .auth-modal, .moscow-intro'
    )
  );
}

function spawnSparks(cx: number, cy: number, count: number, speedScale: number, nowSec: number): void {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const speed = (35 + Math.random() * 115) * speedScale;
    if (ballState.sparks.length > 48) {
      ballState.sparks.shift();
    }
    ballState.sparks.push({
      x: cx + (Math.random() - 0.5) * 14,
      y: cy + (Math.random() - 0.5) * 14,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      glyph: SPARK_GLYPHS[Math.floor(Math.random() * SPARK_GLYPHS.length)],
      bornSec: nowSec,
      lifeSec: 0.35 + Math.random() * 0.45,
    });
  }
}

function pickNewBallTarget(nowSec: number, forceDart = false): void {
  const r = Math.random();
  if (forceDart || r < 0.32) {
    ballState.mode = 'dart';
    ballState.targetU = 0.12 + Math.random() * 0.76;
    ballState.targetV = 0.13 + Math.random() * 0.48;
    ballState.curlSign = Math.random() < 0.5 ? -1 : 1;
    ballState.nextDecisionSec = nowSec + 0.55 + Math.random() * 0.65;
    ballState.charge = Math.max(ballState.charge, 0.92);
  } else if (r < 0.56) {
    ballState.mode = 'levitate';
    ballState.targetU = Math.max(0.12, Math.min(0.88, ballState.u + (Math.random() - 0.5) * 0.08));
    ballState.targetV = Math.max(0.12, Math.min(0.62, ballState.v + (Math.random() - 0.5) * 0.07));
    ballState.nextDecisionSec = nowSec + 1.1 + Math.random() * 1.6;
  } else {
    ballState.mode = 'wander';
    ballState.targetU = 0.12 + Math.random() * 0.76;
    ballState.targetV = 0.12 + Math.random() * 0.5;
    ballState.curlSign = Math.random() < 0.5 ? -1 : 1;
    ballState.nextDecisionSec = nowSec + 2.0 + Math.random() * 2.4;
  }
}

/**
 * Binds global pointer listeners so the user can grab, drag, fling, or click-shockwave
 * the Ball Lightning ASCII Globe anywhere it floats (without blocking UI buttons/sliders).
 */
export function bindBallLightningInteraction(): () => void {
  const syncDocAttributes = () => {
    const root = document.documentElement;
    if (ballState.isDragging) {
      root.setAttribute('data-globe-drag', 'true');
      root.removeAttribute('data-globe-hover');
    } else if (ballState.isHovered) {
      root.setAttribute('data-globe-hover', 'true');
      root.removeAttribute('data-globe-drag');
    } else {
      root.removeAttribute('data-globe-hover');
      root.removeAttribute('data-globe-drag');
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (isInteractiveUiElement(e.target)) return;

    const dist = Math.hypot(e.clientX - ballState.screenCx, e.clientY - ballState.screenCy);
    if (dist > ballState.screenRadius * 1.42) return;

    ballState.isDragging = true;
    ballState.pointerId = e.pointerId;
    ballState.downClientX = e.clientX;
    ballState.downClientY = e.clientY;
    ballState.downTimeMs = performance.now();
    ballState.lastMoveMs = ballState.downTimeMs;
    ballState.lastPointerClientX = e.clientX;
    ballState.lastPointerClientY = e.clientY;
    ballState.dragTargetU = Math.max(0.08, Math.min(0.92, e.clientX / Math.max(1, ballState.viewportW)));
    ballState.dragTargetV = Math.max(0.08, Math.min(0.84, e.clientY / Math.max(1, ballState.viewportH)));
    ballState.charge = 1.3;
    spawnSparks(ballState.screenCx, ballState.screenCy, 8, 0.9, performance.now() * 0.001);
    syncDocAttributes();
  };

  const onPointerMove = (e: PointerEvent) => {
    const nowMs = performance.now();
    const dtSec = Math.max(0.005, (nowMs - ballState.lastMoveMs) * 0.001);
    const prevX = ballState.lastPointerClientX;
    const prevY = ballState.lastPointerClientY;
    ballState.lastPointerClientX = e.clientX;
    ballState.lastPointerClientY = e.clientY;
    ballState.lastMoveMs = nowMs;

    if (ballState.isDragging) {
      const vw = Math.max(1, ballState.viewportW);
      const vh = Math.max(1, ballState.viewportH);
      const nextU = Math.max(0.07, Math.min(0.93, e.clientX / vw));
      const nextV = Math.max(0.08, Math.min(0.86, e.clientY / vh));
      const instVu = (nextU - ballState.dragTargetU) / dtSec;
      const instVv = (nextV - ballState.dragTargetV) / dtSec;
      ballState.vu = ballState.vu * 0.45 + Math.max(-1.6, Math.min(1.6, instVu)) * 0.55;
      ballState.vv = ballState.vv * 0.45 + Math.max(-1.6, Math.min(1.6, instVv)) * 0.55;
      ballState.dragTargetU = nextU;
      ballState.dragTargetV = nextV;
      ballState.charge = 1.35;
      if (Math.hypot(e.clientX - prevX, e.clientY - prevY) > 10) {
        spawnSparks(ballState.screenCx, ballState.screenCy, 2, 0.75, nowMs * 0.001);
      }
      return;
    }

    const overUi = isInteractiveUiElement(e.target);
    const dist = Math.hypot(e.clientX - ballState.screenCx, e.clientY - ballState.screenCy);
    const nextHover = !overUi && dist <= ballState.screenRadius * 1.32;
    if (nextHover !== ballState.isHovered) {
      ballState.isHovered = nextHover;
      syncDocAttributes();
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!ballState.isDragging) return;
    ballState.isDragging = false;
    ballState.pointerId = -1;

    const nowMs = performance.now();
    const nowSec = nowMs * 0.001;
    const movedPx = Math.hypot(e.clientX - ballState.downClientX, e.clientY - ballState.downClientY);
    const heldMs = nowMs - ballState.downTimeMs;

    if (movedPx < 14 && heldMs < 320) {
      // Quick click / poke -> Plasma Shockwave Discharge + sudden ball-lightning dart!
      ballState.shockwaveBornSec = nowSec;
      ballState.shockwaveX = ballState.screenCx;
      ballState.shockwaveY = ballState.screenCy;
      ballState.spinSpeed = 3.6;
      ballState.charge = 1.65;
      spawnSparks(ballState.screenCx, ballState.screenCy, 18, 1.5, nowSec);
      pickNewBallTarget(nowSec, true);
    } else {
      // Flung with hand momentum!
      ballState.mode = 'flung';
      ballState.nextDecisionSec = nowSec + 1.45;
      ballState.spinSpeed = Math.min(3.4, 0.8 + Math.hypot(ballState.vu, ballState.vv) * 2.2);
      ballState.charge = 1.25;
      spawnSparks(ballState.screenCx, ballState.screenCy, 10, 1.15, nowSec);
    }
    syncDocAttributes();
  };

  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });

  return () => {
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    ballState.isDragging = false;
    ballState.isHovered = false;
    syncDocAttributes();
  };
}

function drawJaggedLightningArc(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  segments: number,
  jitterPx: number,
  seed: number,
  colorStr: string,
  alpha: number,
  lineWidth = 1.4
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = colorStr;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = clamp01(alpha);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const envelope = Math.sin(t * Math.PI);
    const offset = (pseudoNoise(seed + i * 13.37) - 0.5) * 2 * jitterPx * envelope;
    ctx.lineTo(x0 + dx * t + nx * offset, y0 + dy * t + ny * offset);
  }
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws the autonomous & interactive Ball-Lightning ASCII Globe that roams erratically
 * like ball lightning (`levitate` / `wander` / `dart` / `flung`) and can be grabbed,
 * dragged, flung, or click-discharged with the mouse or touch.
 */
export function renderAsciiGlobeLayer(
  ctx: CanvasRenderingContext2D,
  opts: AsciiGlobeRenderOptions
): void {
  const {
    width,
    height,
    overscanTopPx = 0,
    timeSec,
    profile,
    pixels,
    sampleCols,
    sampleRows,
    scale,
    animate,
    glitchStrength = 0,
    audioLevel = 0,
  } = opts;

  const viewportW = Math.max(1, width - overscanTopPx * 2);
  const viewportH = Math.max(1, height - overscanTopPx * 2);
  const isMobile = viewportW <= 760;
  const isTablet = viewportW > 760 && viewportW <= 1100;

  // Step Ball Lightning erratic kinematics
  const dt =
    ballState.lastStepSec > 0
      ? Math.max(0.004, Math.min(0.08, timeSec - ballState.lastStepSec))
      : 0.016;
  ballState.lastStepSec = timeSec;

  if (animate) {
    if (ballState.isDragging) {
      const du = ballState.dragTargetU - ballState.u;
      const dv = ballState.dragTargetV - ballState.v;
      ballState.u += du * Math.min(1, dt * 24);
      ballState.v += dv * Math.min(1, dt * 24);
      ballState.spinSpeed = Math.min(3.5, 0.9 + Math.hypot(ballState.vu, ballState.vv) * 2.1);
    } else if (ballState.mode === 'flung') {
      ballState.u += ballState.vu * dt;
      ballState.v += ballState.vv * dt;
      ballState.vu *= Math.pow(0.24, dt);
      ballState.vv *= Math.pow(0.24, dt);

      if (ballState.u < 0.08 || ballState.u > 0.92) {
        ballState.vu = -ballState.vu * 0.78;
        ballState.u = Math.max(0.08, Math.min(0.92, ballState.u));
        spawnSparks(
          overscanTopPx + ballState.u * viewportW,
          overscanTopPx + ballState.v * viewportH,
          7,
          1.1,
          timeSec
        );
      }
      if (ballState.v < 0.1 || ballState.v > 0.72) {
        ballState.vv = -ballState.vv * 0.78;
        ballState.v = Math.max(0.1, Math.min(0.72, ballState.v));
        spawnSparks(
          overscanTopPx + ballState.u * viewportW,
          overscanTopPx + ballState.v * viewportH,
          7,
          1.1,
          timeSec
        );
      }
      if (timeSec >= ballState.nextDecisionSec || Math.hypot(ballState.vu, ballState.vv) < 0.05) {
        pickNewBallTarget(timeSec, false);
      }
    } else {
      if (timeSec >= ballState.nextDecisionSec) {
        pickNewBallTarget(timeSec, audioLevel > 0.72 && Math.random() < 0.45);
      }
      const du = ballState.targetU - ballState.u;
      const dv = ballState.targetV - ballState.v;
      const dist = Math.hypot(du, dv);
      if (dist < 0.035 && ballState.mode !== 'levitate') {
        pickNewBallTarget(timeSec, false);
      } else {
        const pull =
          ballState.mode === 'dart'
            ? 2.45
            : ballState.mode === 'levitate'
              ? 0.45
              : 0.95;
        const maxSpd =
          ballState.mode === 'dart'
            ? 0.48
            : ballState.mode === 'levitate'
              ? 0.06
              : 0.17;
        const dirU = dist > 0.001 ? du / dist : 0;
        const dirV = dist > 0.001 ? dv / dist : 0;
        // Perpendicular curl force so ball lightning curves & weaves unpredictably instead of moving on a line/arc
        const curlWave =
          Math.sin(timeSec * 2.7 + ballState.u * 9) * 0.65 +
          Math.cos(timeSec * 4.3 - ballState.v * 11) * 0.35;
        const curlStrength = ballState.mode === 'wander' ? 0.22 : ballState.mode === 'dart' ? 0.35 : 0.08;
        const accelU = dirU * pull + -dirV * curlStrength * ballState.curlSign * curlWave;
        const accelV = dirV * pull + dirU * curlStrength * ballState.curlSign * curlWave;

        ballState.vu = (ballState.vu + accelU * dt) * Math.pow(0.18, dt);
        ballState.vv = (ballState.vv + accelV * dt) * Math.pow(0.18, dt);
        const spd = Math.hypot(ballState.vu, ballState.vv);
        if (spd > maxSpd) {
          ballState.vu = (ballState.vu / spd) * maxSpd;
          ballState.vv = (ballState.vv / spd) * maxSpd;
        }
        ballState.u = Math.max(0.09, Math.min(0.91, ballState.u + ballState.vu * dt));
        ballState.v = Math.max(0.1, Math.min(0.66, ballState.v + ballState.vv * dt));
      }
      ballState.spinSpeed += (0.46 + audioLevel * 0.55 - ballState.spinSpeed) * Math.min(1, dt * 3);
    }

    ballState.spinAngle += ballState.spinSpeed * dt;
    ballState.charge = Math.max(
      0.22 + audioLevel * 0.55,
      ballState.charge - dt * (ballState.isDragging ? 0 : 0.55)
    );

    // Spontaneous plasma spark shedding when darting or excited
    if (
      (ballState.mode === 'dart' || ballState.charge > 0.75) &&
      Math.random() < 0.38
    ) {
      spawnSparks(
        overscanTopPx + ballState.u * viewportW,
        overscanTopPx + ballState.v * viewportH,
        1,
        0.55,
        timeSec
      );
    }
  } else {
    ballState.u = 0.78;
    ballState.v = 0.22;
  }

  // High-frequency ball-lightning plasma tremor
  const tremorX = animate
    ? (Math.sin(timeSec * 17.3) * 2.2 + Math.cos(timeSec * 29.1) * 1.4) * (0.6 + ballState.charge * 0.7)
    : 0;
  const tremorY = animate
    ? (Math.cos(timeSec * 19.7) * 2.0 + Math.sin(timeSec * 23.4) * 1.3) * (0.6 + ballState.charge * 0.7)
    : 0;

  const breatheScale = animate
    ? 0.92 + 0.14 * Math.sin(timeSec * 2.1) + audioLevel * 0.1 + (ballState.isDragging ? 0.12 : 0)
    : 1;
  const depthPresence = 0.94;

  const baseRadius = isMobile
    ? Math.max(36, Math.min(44, Math.round(viewportW * 0.1)))
    : isTablet
      ? Math.max(50, Math.min(60, Math.round(viewportW * 0.054)))
      : Math.max(58, Math.min(72, Math.round(Math.min(viewportW * 0.05, viewportH * 0.08))));
  const radius = Math.max(
    24,
    Math.round(baseRadius * breatheScale * (1 + Math.max(0, scale - 1) * 0.34))
  );

  const cx = Math.round(overscanTopPx + ballState.u * viewportW + tremorX);
  const cy = Math.round(overscanTopPx + ballState.v * viewportH + tremorY);

  // Record screen-space coordinates for accurate mouse/touch grab hit-testing
  ballState.screenCx = cx - overscanTopPx;
  ballState.screenCy = cy - overscanTopPx;
  ballState.screenRadius = radius;
  ballState.viewportW = viewportW;
  ballState.viewportH = viewportH;
  ballState.overscanPx = overscanTopPx;

  const cellStep = isMobile ? 5 : 7;
  const halfCell = cellStep * 0.5;
  const tileOverlap = cellStep + 0.6;

  const palette = resolveGlobePalette(profile);
  const spin = animate ? ballState.spinAngle : 1.1;
  const cloudSpin = animate ? ballState.spinAngle * 1.24 : 1.4;
  const cosSpin = Math.cos(spin);
  const sinSpin = Math.sin(spin);
  const skyHarmRgb = parseHexRgb(profile.tintHex);

  const sampleSkyMask = (px: number, py: number): number => {
    const sx = Math.max(0, Math.min(sampleCols - 1, Math.floor((px / width) * sampleCols)));
    const sy = Math.max(0, Math.min(sampleRows - 1, Math.floor((py / height) * sampleRows)));
    const idx = (sy * sampleCols + sx) * 4;
    const lum = (54 * pixels[idx] + 183 * pixels[idx + 1] + 19 * pixels[idx + 2]) / 65280;
    return (0.56 + 0.44 * smoothstep(0.08, 0.3, lum)) * depthPresence;
  };

  ctx.save();

  // 1. Subtle deep-cosmos upper sky veil (vignette canopy framing Earth)
  const [sr, sg, sb] = palette.shadowTint;
  const cosmosBottom = overscanTopPx + viewportH * 0.34;
  const cosmosVeil = ctx.createLinearGradient(0, overscanTopPx, 0, cosmosBottom);
  cosmosVeil.addColorStop(0, `rgba(${Math.round(sr)},${Math.round(sg)},${Math.round(sb)},0.22)`);
  cosmosVeil.addColorStop(0.55, `rgba(${Math.round(sr)},${Math.round(sg)},${Math.round(sb)},0.08)`);
  cosmosVeil.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = cosmosVeil;
  ctx.fillRect(0, 0, width, cosmosBottom);

  // Subtle distant ASCII stars flanking the globe in upper canopy sky
  ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < COSMOS_STARS.length; i++) {
    const star = COSMOS_STARS[i];
    const sx = overscanTopPx + star.u * viewportW;
    const sy = overscanTopPx + star.v * viewportH;
    const dist = Math.hypot(sx - cx, sy - cy);
    if (dist < radius * 1.1 || dist > radius * 2.5) continue;
    const skyMask = sampleSkyMask(sx, sy);
    if (skyMask < 0.25) continue;
    const twinkle = animate ? 0.55 + 0.45 * Math.sin(timeSec * 1.8 + star.phase) : 0.75;
    ctx.globalAlpha = skyMask * 0.44 * twinkle;
    ctx.fillStyle = cachedRgba(palette.clouds[0], palette.clouds[1], palette.clouds[2]);
    ctx.fillText(star.glyph, sx, sy);
  }
  ctx.globalAlpha = 1;

  // 2. Pulsing Ball-Lightning Plasma Corona behind the sphere
  const [ar, ag, ab] = palette.atmosphere;
  const beatSwell = animate
    ? Math.pow(0.5 + 0.5 * Math.sin(timeSec * (profile.grooveBpm / 120) * Math.PI * 2), 1.6)
    : 0.5;
  const chargeBoost = Math.min(0.65, ballState.charge * 0.35);
  const haloRadius = radius * (1.42 + (animate ? beatSwell * 0.14 + chargeBoost * 0.35 : 0));
  const halo = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, haloRadius);
  halo.addColorStop(
    0,
    `rgba(${Math.round(ar)},${Math.round(ag)},${Math.round(ab)},${(0.36 + beatSwell * 0.1 + chargeBoost * 0.24).toFixed(3)})`
  );
  halo.addColorStop(
    0.58,
    `rgba(${Math.round(ar)},${Math.round(ag)},${Math.round(ab)},${(0.14 + beatSwell * 0.05 + chargeBoost * 0.12).toFixed(3)})`
  );
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
  ctx.fill();

  // 2b. Trailing ionized ASCII plasma sparks & click shockwave ring
  if (animate && ballState.sparks.length > 0) {
    ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    const sparkColor = cachedRgba(palette.cityLight[0], palette.cityLight[1], palette.cityLight[2]);
    for (let i = ballState.sparks.length - 1; i >= 0; i--) {
      const sp = ballState.sparks[i];
      const age = timeSec - sp.bornSec;
      if (age >= sp.lifeSec) {
        ballState.sparks.splice(i, 1);
        continue;
      }
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vx *= 0.93;
      sp.vy *= 0.93;
      const lifeRatio = 1 - age / sp.lifeSec;
      ctx.globalAlpha = lifeRatio * 0.85;
      ctx.fillStyle = sparkColor;
      ctx.fillText(sp.glyph, sp.x, sp.y);
    }
    ctx.globalAlpha = 1;
  }

  const shockAge = timeSec - ballState.shockwaveBornSec;
  if (animate && shockAge >= 0 && shockAge < 0.85) {
    const shockProgress = shockAge / 0.85;
    const shockRad = radius * (1.05 + shockProgress * 2.4);
    const shockAlpha = (1 - shockProgress) * 0.82;
    const ringCount = 20;
    const sx0 = ballState.shockwaveX + overscanTopPx;
    const sy0 = ballState.shockwaveY + overscanTopPx;
    ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = cachedRgba(palette.cityLight[0], palette.cityLight[1], palette.cityLight[2]);
    ctx.globalAlpha = shockAlpha;
    for (let i = 0; i < ringCount; i++) {
      const ang = (Math.PI * 2 * i) / ringCount + shockProgress * 1.6;
      const rx = sx0 + Math.cos(ang) * shockRad;
      const ry = sy0 + Math.sin(ang) * shockRad;
      ctx.fillText(SPARK_GLYPHS[i % SPARK_GLYPHS.length], rx, ry);
    }
    ctx.globalAlpha = 1;
  }

  // 3. Flush-tiled Minecraft voxel blocks + crisp bright ASCII glyphs on 3D sphere
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = `700 ${cellStep + 1}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

  const invRadius = 1 / radius;
  const radiusSq = radius * radius;
  const startX = cx - Math.floor(radius / cellStep) * cellStep;
  const endX = cx + radius;
  const startY = Math.max(0, cy - Math.floor(radius / cellStep) * cellStep);
  const endY = Math.min(height, cy + radius);
  const tickGlitch = glitchStrength > 0.2 ? Math.floor(timeSec * 12) : 0;

  for (let py = startY; py <= endY; py += cellStep) {
    const dy = py - cy;
    const dySq = dy * dy;
    const ny = -dy * invRadius;

    const rowSeed = Math.sin((py + tickGlitch * 13) * 19.37) * 43758.5453;
    const rowJitterX =
      glitchStrength > 0.2 && rowSeed - Math.floor(rowSeed) > 0.88
        ? Math.round((rowSeed - Math.floor(rowSeed) - 0.94) * 90)
        : 0;

    for (let px = startX; px <= endX; px += cellStep) {
      if (px < 0 || px > width) continue;
      const dx = px - cx;
      const rSq = dx * dx + dySq;
      if (rSq > radiusSq) continue;

      const skyMask = sampleSkyMask(px, py);
      if (skyMask < 0.08) continue;

      const nx = dx * invRadius;
      const nz = Math.sqrt(Math.max(0, 1 - rSq / radiusSq));

      const ndotl = nx * LIGHT_X + ny * LIGHT_Y + nz * LIGHT_Z;
      const diffuse = smoothstep(-0.22, 0.84, ndotl);
      const fresnel = Math.pow(1 - nz, 2.45);

      const py1 = ny * COS_PITCH - nz * SIN_PITCH;
      const pz1 = ny * SIN_PITCH + nz * COS_PITCH;
      const tx = nx * COS_TILT - py1 * SIN_TILT;
      const ty = nx * SIN_TILT + py1 * COS_TILT;
      const tz = pz1;

      const sx = tx * cosSpin + tz * sinSpin;
      const sz = -tx * sinSpin + tz * cosSpin;
      const lat = Math.asin(Math.max(-1, Math.min(1, ty)));
      const lon = Math.atan2(sx, sz);

      const terrain = sampleTerrain(lat, lon);
      const cloudCurl = sampleCloudSwirl(lat, lon - (cloudSpin - spin));
      const isCloud = cloudCurl > 0.54;

      let baseRgb: [number, number, number];
      let glyph = '~';
      let litScale = 0.24 + diffuse * 0.92;

      if (isCloud) {
        baseRgb = palette.clouds;
        glyph = cloudCurl > 0.72 ? '▓' : cloudCurl > 0.62 ? '▒' : '░';
        litScale = 0.3 + diffuse * 0.94;
      } else if (terrain === TerrainCode.Ice) {
        baseRgb = palette.clouds;
        glyph = ndotl > 0.35 ? '▓' : ndotl > 0.05 ? '▒' : '░';
      } else if (terrain === TerrainCode.Highland) {
        baseRgb = palette.highland;
        glyph = ndotl > 0.4 ? '▓' : ndotl > 0.1 ? '#' : '▒';
      } else if (terrain === TerrainCode.Land) {
        const citySeed = Math.abs(Math.sin(lon * 53.7 + lat * 71.9));
        if (ndotl < -0.1 && citySeed > 0.94) {
          baseRgb = palette.cityLight;
          glyph = '*';
          litScale = 0.96;
        } else {
          const elevationVar = Math.sin(lon * 11 + lat * 7);
          baseRgb = elevationVar > 0.22 ? palette.savanna : palette.forest;
          glyph = ndotl > 0.42 ? '@' : ndotl > 0.14 ? '#' : '▒';
        }
      } else if (terrain === TerrainCode.Shallows) {
        baseRgb = palette.shallows;
        glyph = ndotl > 0.26 ? '+' : '≈';
      } else {
        baseRgb = lerpRgb(palette.oceanDeep, palette.oceanLit, diffuse);
        const hx = nx + LIGHT_X;
        const hy = ny + LIGHT_Y;
        const hz = nz + LIGHT_Z;
        const hLen = Math.hypot(hx, hy, hz) || 1;
        const spec = Math.pow(Math.max(0, hz / hLen), 22);
        if (spec > 0.34) {
          baseRgb = lerpRgb(baseRgb, palette.clouds, spec * 0.62);
          glyph = '*';
        } else {
          glyph = ndotl > 0.35 ? '≈' : ndotl > 0.0 ? '~' : '·';
        }
      }

      const litR = baseRgb[0] * litScale;
      const litG = baseRgb[1] * litScale;
      const litB = baseRgb[2] * litScale;
      const shadowBlend = (1 - diffuse) * 0.38;
      const harmR = lerp(litR, palette.shadowTint[0], shadowBlend);
      const harmG = lerp(litG, palette.shadowTint[1], shadowBlend);
      const harmB = lerp(litB, palette.shadowTint[2], shadowBlend);

      const finalR = lerp(lerp(harmR, skyHarmRgb[0], 0.1), palette.atmosphere[0] * 1.16, fresnel * 0.58);
      const finalG = lerp(lerp(harmG, skyHarmRgb[1], 0.1), palette.atmosphere[1] * 1.16, fresnel * 0.58);
      const finalB = lerp(lerp(harmB, skyHarmRgb[2], 0.1), palette.atmosphere[2] * 1.16, fresnel * 0.58);

      const drawX = px + rowJitterX;
      const edgeFade = smoothstep(1.0, 0.87, Math.sqrt(rSq) * invRadius);
      const cellAlpha = skyMask * (0.9 + 0.1 * edgeFade);

      // Flush opaque/translucent voxel tile (no 1px wireframe holes letting sky dots bleed through)
      ctx.fillStyle = cachedRgba(finalR * 0.62, finalG * 0.62, finalB * 0.62, cellAlpha);
      ctx.fillRect(drawX - halfCell, py - halfCell, tileOverlap, tileOverlap);

      // Illuminated ASCII character perched inside each Minecraft-style voxel block without white clipping
      const glyphR = finalR * 1.24;
      const glyphG = finalG * 1.24;
      const glyphB = finalB * 1.24;
      const peak = Math.max(glyphR, glyphG, glyphB);
      const glyphCap = peak > MAX_CHANNEL_BRIGHTNESS ? MAX_CHANNEL_BRIGHTNESS / peak : 1;
      ctx.fillStyle = cachedRgba(
        glyphR * glyphCap,
        glyphG * glyphCap,
        glyphB * glyphCap,
        cellAlpha
      );
      ctx.fillText(glyph, drawX, py);
    }
  }

  // 4. Ball-Lightning jagged electric corona tendrils + cursor Tesla plasma tether
  if (animate) {
    const arcSeedBase = Math.floor(timeSec * 18);
    const tendrilCount = ballState.isDragging ? 9 : ballState.mode === 'dart' ? 8 : 5;
    const arcColor = cachedRgba(palette.atmosphere[0], palette.atmosphere[1], palette.atmosphere[2]);
    const hotColor = cachedRgba(palette.cityLight[0], palette.cityLight[1], palette.cityLight[2]);

    for (let i = 0; i < tendrilCount; i++) {
      const seed = arcSeedBase * 23 + i * 41;
      if (!ballState.isDragging && pseudoNoise(seed + 1) < 0.25) continue;
      const angle0 = (Math.PI * 2 * i) / tendrilCount + Math.sin(timeSec * 2.4 + i) * 0.45;
      const angle1 = angle0 + (pseudoNoise(seed + 2) - 0.5) * 0.7;
      const r0 = radius * 0.92;
      const r1 = radius * (1.24 + pseudoNoise(seed + 3) * (0.38 + ballState.charge * 0.35));
      const x0 = cx + Math.cos(angle0) * r0;
      const y0 = cy + Math.sin(angle0) * r0;
      const x1 = cx + Math.cos(angle1) * r1;
      const y1 = cy + Math.sin(angle1) * r1;

      drawJaggedLightningArc(
        ctx,
        x0,
        y0,
        x1,
        y1,
        5,
        10 + ballState.charge * 8,
        seed,
        i % 2 === 0 ? hotColor : arcColor,
        0.52 + Math.min(0.4, ballState.charge * 0.3),
        i % 2 === 0 ? 1.5 : 1.15
      );
    }

    // Tesla plasma tether jumping between ball lightning and nearby mouse cursor
    if (ballState.lastPointerClientX > 0 && ballState.lastPointerClientY > 0) {
      const ptrCanvasX = overscanTopPx + ballState.lastPointerClientX;
      const ptrCanvasY = overscanTopPx + ballState.lastPointerClientY;
      const ptrDist = Math.hypot(ptrCanvasX - cx, ptrCanvasY - cy);
      const maxTetherDist = radius * (ballState.isDragging ? 5.5 : 2.65);

      if (ptrDist > 4 && ptrDist < maxTetherDist) {
        const tetherStrength = ballState.isDragging
          ? 0.92
          : (1 - ptrDist / maxTetherDist) * 0.75;
        const dirX = (ptrCanvasX - cx) / ptrDist;
        const dirY = (ptrCanvasY - cy) / ptrDist;
        const startX = cx + dirX * radius * 0.85;
        const startY = cy + dirY * radius * 0.85;

        drawJaggedLightningArc(
          ctx,
          startX,
          startY,
          ptrCanvasX,
          ptrCanvasY,
          7,
          14,
          arcSeedBase * 37,
          hotColor,
          tetherStrength,
          1.7
        );
        drawJaggedLightningArc(
          ctx,
          startX,
          startY,
          ptrCanvasX,
          ptrCanvasY,
          6,
          20,
          arcSeedBase * 53 + 9,
          arcColor,
          tetherStrength * 0.7,
          1.2
        );
      }
    }
  }

  ctx.restore();
}
