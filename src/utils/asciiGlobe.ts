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

type Rgb = [number, number, number];

interface GlobePalette {
  oceanDeep: Rgb;
  oceanLit: Rgb;
  shallows: Rgb;
  forest: Rgb;
  savanna: Rgb;
  highland: Rgb;
  clouds: Rgb;
  cityLight: Rgb;
  atmosphere: Rgb;
  shadowTint: Rgb;
}

interface GlobePalettePair {
  primary: GlobePalette;
  secondary: GlobePalette;
}

// Channel-native paired palettes: two distinct, harmonious worlds drawn straight from each tab's theme tokens.
// Main (`dusk`): Warm Amber (#eab98a) + Mist Sage (#c2d2b5)
const PALETTE_PAIR_MAIN: GlobePalettePair = {
  primary: {
    oceanDeep: [48, 30, 18],
    oceanLit: [158, 102, 54],
    shallows: [212, 158, 98],
    forest: [176, 118, 66],
    savanna: [222, 174, 114],
    highland: [232, 185, 138],
    clouds: [232, 220, 200],
    cityLight: [232, 204, 132],
    atmosphere: [232, 185, 138],
    shadowTint: [26, 20, 16],
  },
  secondary: {
    oceanDeep: [26, 40, 32],
    oceanLit: [78, 118, 90],
    shallows: [148, 180, 142],
    forest: [110, 148, 108],
    savanna: [174, 198, 154],
    highland: [194, 210, 181],
    clouds: [226, 228, 212],
    cityLight: [232, 196, 142],
    atmosphere: [194, 210, 181],
    shadowTint: [20, 26, 21],
  },
};

// Deep (`deep`): Ruby Coral (#e88980) + Warm Copper Peach (#ecc09e)
const PALETTE_PAIR_DEEP: GlobePalettePair = {
  primary: {
    oceanDeep: [56, 16, 24],
    oceanLit: [164, 54, 62],
    shallows: [220, 118, 110],
    forest: [142, 62, 66],
    savanna: [206, 112, 104],
    highland: [232, 137, 128],
    clouds: [232, 210, 204],
    cityLight: [232, 192, 158],
    atmosphere: [232, 137, 128],
    shadowTint: [24, 10, 13],
  },
  secondary: {
    oceanDeep: [56, 30, 18],
    oceanLit: [166, 104, 66],
    shallows: [218, 158, 114],
    forest: [152, 98, 68],
    savanna: [212, 156, 112],
    highland: [232, 190, 154],
    clouds: [232, 218, 204],
    cityLight: [232, 137, 128],
    atmosphere: [232, 190, 154],
    shadowTint: [28, 15, 11],
  },
};

// DeepTech (`afterglow`): Night Amethyst (#bda8f2) + Dusk Sunset Gold (#e8c29e)
const PALETTE_PAIR_DEEPTECH: GlobePalettePair = {
  primary: {
    oceanDeep: [32, 22, 64],
    oceanLit: [104, 82, 178],
    shallows: [158, 134, 220],
    forest: [118, 92, 188],
    savanna: [168, 146, 228],
    highland: [189, 168, 232],
    clouds: [222, 214, 232],
    cityLight: [232, 194, 158],
    atmosphere: [189, 168, 232],
    shadowTint: [20, 16, 29],
  },
  secondary: {
    oceanDeep: [48, 28, 34],
    oceanLit: [154, 106, 76],
    shallows: [214, 166, 126],
    forest: [138, 94, 84],
    savanna: [206, 160, 124],
    highland: [232, 194, 158],
    clouds: [230, 218, 212],
    cityLight: [189, 168, 232],
    atmosphere: [232, 194, 158],
    shadowTint: [24, 18, 24],
  },
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

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function parseHexRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const parsed = Number.parseInt(clean, 16);
  if (!Number.isFinite(parsed)) return [231, 187, 148];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function clonePalette(p: GlobePalette): GlobePalette {
  return {
    oceanDeep: [...p.oceanDeep],
    oceanLit: [...p.oceanLit],
    shallows: [...p.shallows],
    forest: [...p.forest],
    savanna: [...p.savanna],
    highland: [...p.highland],
    clouds: [...p.clouds],
    cityLight: [...p.cityLight],
    atmosphere: [...p.atmosphere],
    shadowTint: [...p.shadowTint],
  };
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

function resolveTargetPalettePair(profile: AsciiChannelProfile): GlobePalettePair {
  const [tr, tg, tb] = parseHexRgb(profile.tintHex);
  const distMain = Math.hypot(tr - 231, tg - 187, tb - 148);
  const distDeep = Math.hypot(tr - 200, tg - 72, tb - 82);
  const distTech = Math.hypot(tr - 132, tg - 104, tb - 214);

  // Smooth inverse-distance blending across all 3 channel worlds so transitions never snap
  const wMain = 1 / Math.max(8, distMain * distMain);
  const wDeep = 1 / Math.max(8, distDeep * distDeep);
  const wTech = 1 / Math.max(8, distTech * distTech);
  const wSum = wMain + wDeep + wTech;

  const nMain = wMain / wSum;
  const nDeep = wDeep / wSum;
  const nTech = wTech / wSum;

  const blendOne = (m: GlobePalette, d: GlobePalette, k: GlobePalette): GlobePalette => {
    const dtSum = nDeep + nTech;
    if (dtSum < 0.001) return m;
    const dtMix = interpolatePalette(d, k, nTech / dtSum);
    return interpolatePalette(m, dtMix, clamp01(1 - nMain));
  };

  return {
    primary: blendOne(
      PALETTE_PAIR_MAIN.primary,
      PALETTE_PAIR_DEEP.primary,
      PALETTE_PAIR_DEEPTECH.primary
    ),
    secondary: blendOne(
      PALETTE_PAIR_MAIN.secondary,
      PALETTE_PAIR_DEEP.secondary,
      PALETTE_PAIR_DEEPTECH.secondary
    ),
  };
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
    u: 0.12 + r1 * 0.76,
    v: 0.04 + r2 * 0.3,
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

// ─────────────── Dual Floating Globes: Spring Collision, Title Orbit & Mouse Control ───────────────

type GlobeDriftMode = 'levitate' | 'wander' | 'glide' | 'flung';

interface GlobeBody {
  id: 0 | 1;
  u: number;
  v: number;
  vu: number;
  vv: number;
  targetU: number;
  targetV: number;
  curlSign: number;
  mode: GlobeDriftMode;
  nextDecisionSec: number;
  spinAngle: number;
  spinSpeed: number;
  baseSpin: number;
  breathPhase: number;
  radiusScale: number;
  isDragging: boolean;
  isHovered: boolean;
  dragTargetU: number;
  dragTargetV: number;
  personalOrbitPauseUntil: number;
  personalOrbitWeight: number;
  collisionGlow: number;
  screenCx: number;
  screenCy: number;
  screenRadius: number;
  palette: GlobePalette;
}

function createGlobeBody(id: 0 | 1): GlobeBody {
  const isFirst = id === 0;
  return {
    id,
    u: isFirst ? 0.76 : 0.24,
    v: isFirst ? 0.22 : 0.29,
    vu: isFirst ? -0.012 : 0.013,
    vv: isFirst ? 0.005 : -0.004,
    targetU: isFirst ? 0.34 : 0.68,
    targetV: isFirst ? 0.26 : 0.24,
    curlSign: isFirst ? 1 : -1,
    mode: 'wander',
    nextDecisionSec: 0,
    spinAngle: isFirst ? 1.1 : 3.9,
    spinSpeed: isFirst ? 0.32 : -0.28,
    baseSpin: isFirst ? 0.32 : -0.28,
    breathPhase: isFirst ? 0 : Math.PI * 0.85,
    radiusScale: isFirst ? 1.0 : 0.94,
    isDragging: false,
    isHovered: false,
    dragTargetU: isFirst ? 0.76 : 0.24,
    dragTargetV: isFirst ? 0.22 : 0.29,
    personalOrbitPauseUntil: 0,
    personalOrbitWeight: 1,
    collisionGlow: 0,
    screenCx: 0,
    screenCy: 0,
    screenRadius: 62,
    palette: clonePalette(isFirst ? PALETTE_PAIR_MAIN.primary : PALETTE_PAIR_MAIN.secondary),
  };
}

const ORBIT_INTERVAL_MIN_SEC = 400;
const ORBIT_INTERVAL_MAX_SEC = 600;
const ORBIT_DURATION_SEC = 60;
const ORBIT_TRANSITION_SEC = 3.8;

const worldState = {
  globes: [createGlobeBody(0), createGlobeBody(1)] as [GlobeBody, GlobeBody],
  lastStepSec: 0,
  viewportW: 1440,
  viewportH: 900,
  overscanPx: 44,
  activeDragId: -1 as -1 | 0 | 1,
  pointerId: -1,
  downClientX: 0,
  downClientY: 0,
  downTimeMs: 0,
  lastMoveMs: 0,
  // Periodic title-orbit choreography (every 400–600s for 60s)
  orbitInitialized: false,
  nextOrbitStartSec: 460,
  orbitEndSec: 0,
  orbitRawBlend: 0,
  orbitAngle: 0,
  // Cached smooth title anchor so orbit wraps around "ToniVecherRadio" without per-frame DOM reads
  lastTitleMeasureMs: 0,
  titleTargetU: 0.5,
  titleTargetV: 0.27,
  titleTargetRxU: 0.2,
  titleTargetRyV: 0.14,
  titleU: 0.5,
  titleV: 0.27,
  titleRxU: 0.2,
  titleRyV: 0.14,
  // Cached screen-space obstacles for the two ASCII dancers above "T" and "o"
  lastDancerMeasureMs: 0,
  dancerObstacles: [] as Array<{ u: number; v: number; radiusPx: number }>,
};

function randomOrbitWaitSec(): number {
  return ORBIT_INTERVAL_MIN_SEC + Math.random() * (ORBIT_INTERVAL_MAX_SEC - ORBIT_INTERVAL_MIN_SEC);
}

function isInteractiveUiElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, label, [role="slider"], [role="button"], [role="radio"], [role="tab"], .island-header-shell, .floating-mini-dock, .auth-modal, .moscow-intro'
    )
  );
}

function pickNewBallTarget(ball: GlobeBody, nowSec: number, gentleGlide = false): void {
  const r = Math.random();
  if (gentleGlide || r < 0.26) {
    ball.mode = 'glide';
    ball.targetU = 0.13 + Math.random() * 0.74;
    ball.targetV = 0.13 + Math.random() * 0.44;
    ball.curlSign = Math.random() < 0.5 ? -1 : 1;
    ball.nextDecisionSec = nowSec + 4.5 + Math.random() * 3.5;
  } else if (r < 0.52) {
    ball.mode = 'levitate';
    ball.targetU = Math.max(0.13, Math.min(0.87, ball.u + (Math.random() - 0.5) * 0.08));
    ball.targetV = Math.max(0.12, Math.min(0.56, ball.v + (Math.random() - 0.5) * 0.06));
    ball.nextDecisionSec = nowSec + 3.5 + Math.random() * 3.5;
  } else {
    ball.mode = 'wander';
    ball.targetU = 0.13 + Math.random() * 0.74;
    ball.targetV = 0.13 + Math.random() * 0.45;
    ball.curlSign = Math.random() < 0.5 ? -1 : 1;
    ball.nextDecisionSec = nowSec + 5.5 + Math.random() * 4.5;
  }
}

function refreshTitleAnchor(viewportW: number, viewportH: number): void {
  const nowMs = performance.now();
  if (nowMs - worldState.lastTitleMeasureMs < 450) return;
  worldState.lastTitleMeasureMs = nowMs;

  const titleEl = document.querySelector<HTMLElement>('.hero-display-title');
  if (!titleEl || viewportW <= 0 || viewportH <= 0) return;

  const rect = titleEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  // Only anchor to the DOM title if it is reasonably near the viewport
  if (rect.bottom < -40 || rect.top > viewportH + 40) {
    worldState.titleTargetU = 0.5;
    worldState.titleTargetV = 0.27;
    worldState.titleTargetRxU = viewportW <= 760 ? 0.3 : 0.2;
    worldState.titleTargetRyV = viewportW <= 760 ? 0.12 : 0.13;
    return;
  }

  const cx = rect.left + rect.width * 0.5;
  const cy = rect.top + rect.height * 0.5;
  const padPx = Math.max(46, Math.min(92, worldState.globes[0].screenRadius * 1.35));

  worldState.titleTargetU = Math.max(0.24, Math.min(0.76, cx / viewportW));
  worldState.titleTargetV = Math.max(0.18, Math.min(0.52, cy / viewportH));
  worldState.titleTargetRxU = Math.max(
    0.14,
    Math.min(0.38, (rect.width * 0.5 + padPx) / viewportW)
  );
  worldState.titleTargetRyV = Math.max(
    0.09,
    Math.min(0.24, (rect.height * 0.5 + padPx * 1.05 + 26) / viewportH)
  );
}

function refreshDancerObstacles(viewportW: number, viewportH: number): void {
  const nowMs = performance.now();
  if (nowMs - worldState.lastDancerMeasureMs < 350) return;
  worldState.lastDancerMeasureMs = nowMs;

  if (viewportW <= 0 || viewportH <= 0) {
    worldState.dancerObstacles = [];
    return;
  }

  const nodes = document.querySelectorAll<HTMLElement>('.ascii-dancer[data-ascii-dancer]');
  const next: Array<{ u: number; v: number; radiusPx: number }> = [];
  nodes.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    if (rect.bottom < -40 || rect.top > viewportH + 40) return;
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const radiusPx = Math.max(18, Math.hypot(rect.width, rect.height) * 0.5);
    next.push({
      u: cx / viewportW,
      v: cy / viewportH,
      radiusPx,
    });
  });
  worldState.dancerObstacles = next;
}

/**
 * Binds global pointer listeners so the user can grab, stop, drag, or fling
 * either of the two ASCII Globes at any time (even during title-orbit choreography).
 */
export function bindBallLightningInteraction(): () => void {
  const syncDocAttributes = () => {
    const root = document.documentElement;
    const anyDragging = worldState.globes.some((g) => g.isDragging);
    const anyHovered = worldState.globes.some((g) => g.isHovered);
    if (anyDragging) {
      root.setAttribute('data-globe-drag', 'true');
      root.removeAttribute('data-globe-hover');
    } else if (anyHovered) {
      root.setAttribute('data-globe-hover', 'true');
      root.removeAttribute('data-globe-drag');
    } else {
      root.removeAttribute('data-globe-hover');
      root.removeAttribute('data-globe-drag');
    }
  };

  const pickClosestGlobe = (clientX: number, clientY: number, radiusFactor: number): GlobeBody | null => {
    let best: GlobeBody | null = null;
    let bestDist = Infinity;
    for (const g of worldState.globes) {
      const d = Math.hypot(clientX - g.screenCx, clientY - g.screenCy);
      if (d <= g.screenRadius * radiusFactor && d < bestDist) {
        best = g;
        bestDist = d;
      }
    }
    return best;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (isInteractiveUiElement(e.target)) return;

    const hit = pickClosestGlobe(e.clientX, e.clientY, 1.4);
    if (!hit) return;

    hit.isDragging = true;
    hit.vu *= 0.25;
    hit.vv *= 0.25;
    hit.personalOrbitPauseUntil = performance.now() * 0.001 + 6;
    worldState.activeDragId = hit.id;
    worldState.pointerId = e.pointerId;
    worldState.downClientX = e.clientX;
    worldState.downClientY = e.clientY;
    worldState.downTimeMs = performance.now();
    worldState.lastMoveMs = worldState.downTimeMs;
    hit.dragTargetU = Math.max(0.07, Math.min(0.93, e.clientX / Math.max(1, worldState.viewportW)));
    hit.dragTargetV = Math.max(0.08, Math.min(0.86, e.clientY / Math.max(1, worldState.viewportH)));
    syncDocAttributes();
  };

  const onPointerMove = (e: PointerEvent) => {
    const nowMs = performance.now();
    const dtSec = Math.max(0.006, (nowMs - worldState.lastMoveMs) * 0.001);
    worldState.lastMoveMs = nowMs;

    if (worldState.activeDragId !== -1) {
      const dragged = worldState.globes[worldState.activeDragId];
      const vw = Math.max(1, worldState.viewportW);
      const vh = Math.max(1, worldState.viewportH);
      const nextU = Math.max(0.07, Math.min(0.93, e.clientX / vw));
      const nextV = Math.max(0.08, Math.min(0.86, e.clientY / vh));
      const instVu = (nextU - dragged.dragTargetU) / dtSec;
      const instVv = (nextV - dragged.dragTargetV) / dtSec;
      dragged.vu = dragged.vu * 0.52 + Math.max(-0.75, Math.min(0.75, instVu)) * 0.48;
      dragged.vv = dragged.vv * 0.52 + Math.max(-0.75, Math.min(0.75, instVv)) * 0.48;
      dragged.dragTargetU = nextU;
      dragged.dragTargetV = nextV;
      dragged.personalOrbitPauseUntil = nowMs * 0.001 + 5;
      return;
    }

    const overUi = isInteractiveUiElement(e.target);
    const hovered = overUi ? null : pickClosestGlobe(e.clientX, e.clientY, 1.3);
    let changed = false;
    for (const g of worldState.globes) {
      const next = hovered === g;
      if (g.isHovered !== next) {
        g.isHovered = next;
        changed = true;
      }
    }
    if (changed) {
      syncDocAttributes();
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (worldState.activeDragId === -1) return;
    const dragged = worldState.globes[worldState.activeDragId];
    dragged.isDragging = false;
    worldState.activeDragId = -1;
    worldState.pointerId = -1;

    const nowMs = performance.now();
    const nowSec = nowMs * 0.001;
    const movedPx = Math.hypot(e.clientX - worldState.downClientX, e.clientY - worldState.downClientY);
    const heldMs = nowMs - worldState.downTimeMs;

    if (movedPx < 14 && heldMs < 320) {
      // Quick tap/click: smoothly stop the globe in place with a playful spin pause
      dragged.vu *= 0.12;
      dragged.vv *= 0.12;
      dragged.mode = 'levitate';
      dragged.targetU = dragged.u;
      dragged.targetV = dragged.v;
      dragged.nextDecisionSec = nowSec + 4.2;
      dragged.personalOrbitPauseUntil = nowSec + 4.2;
      dragged.spinSpeed = (dragged.baseSpin >= 0 ? 1 : -1) * 1.45;
    } else if (Math.hypot(dragged.vu, dragged.vv) < 0.05) {
      // Held still and released -> stays gently parked where placed
      dragged.vu *= 0.2;
      dragged.vv *= 0.2;
      dragged.mode = 'levitate';
      dragged.targetU = dragged.u;
      dragged.targetV = dragged.v;
      dragged.nextDecisionSec = nowSec + 3.6;
      dragged.personalOrbitPauseUntil = nowSec + 3.6;
    } else {
      // Flung with smooth momentum & bounce physics
      dragged.mode = 'flung';
      dragged.nextDecisionSec = nowSec + 2.8;
      dragged.personalOrbitPauseUntil = nowSec + 4.2;
      const sign = dragged.baseSpin >= 0 ? 1 : -1;
      dragged.spinSpeed = sign * Math.min(1.8, 0.55 + Math.hypot(dragged.vu, dragged.vv) * 1.5);
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
    for (const g of worldState.globes) {
      g.isDragging = false;
      g.isHovered = false;
    }
    worldState.activeDragId = -1;
    syncDocAttributes();
  };
}

function stepSingleGlobe(
  ball: GlobeBody,
  dt: number,
  timeSec: number,
  audioLevel: number,
  globalOrbitSmooth: number
): void {
  // Smooth personal orbit weight so grabbing/throwing during an orbit never snaps
  const wantsPersonalOrbit = !ball.isDragging && timeSec >= ball.personalOrbitPauseUntil;
  const targetPersonalWeight = wantsPersonalOrbit ? 1 : 0;
  const weightRate = wantsPersonalOrbit ? 0.55 : 5.5;
  ball.personalOrbitWeight +=
    (targetPersonalWeight - ball.personalOrbitWeight) * (1 - Math.exp(-dt * weightRate));

  const orbitBlend = globalOrbitSmooth * ball.personalOrbitWeight;

  if (ball.isDragging) {
    const du = ball.dragTargetU - ball.u;
    const dv = ball.dragTargetV - ball.v;
    const follow = 1 - Math.exp(-dt * 18);
    ball.u += du * follow;
    ball.v += dv * follow;
    const sign = ball.baseSpin >= 0 ? 1 : -1;
    ball.spinSpeed = sign * Math.min(1.9, 0.55 + Math.hypot(ball.vu, ball.vv) * 1.25);
  } else if (ball.mode === 'flung' && orbitBlend < 0.25) {
    ball.u += ball.vu * dt;
    ball.v += ball.vv * dt;
    const damp = Math.pow(0.36, dt);
    ball.vu *= damp;
    ball.vv *= damp;

    if (ball.u < 0.08 || ball.u > 0.92) {
      ball.vu = -ball.vu * 0.78;
      ball.u = Math.max(0.08, Math.min(0.92, ball.u));
    }
    if (ball.v < 0.09 || ball.v > 0.72) {
      ball.vv = -ball.vv * 0.78;
      ball.v = Math.max(0.09, Math.min(0.72, ball.v));
    }
    if (timeSec >= ball.nextDecisionSec || Math.hypot(ball.vu, ball.vv) < 0.022) {
      pickNewBallTarget(ball, timeSec, false);
    }
  } else {
    // 1. Free autonomous drift acceleration
    if (orbitBlend < 0.85 && timeSec >= ball.nextDecisionSec) {
      pickNewBallTarget(ball, timeSec, false);
    }

    const duFree = ball.targetU - ball.u;
    const dvFree = ball.targetV - ball.v;
    const distFree = Math.hypot(duFree, dvFree);
    if (orbitBlend < 0.5 && distFree < 0.032 && ball.mode !== 'levitate') {
      pickNewBallTarget(ball, timeSec, false);
    }

    const pull = ball.mode === 'glide' ? 0.3 : ball.mode === 'levitate' ? 0.1 : 0.19;
    const maxFreeSpd = ball.mode === 'glide' ? 0.068 : ball.mode === 'levitate' ? 0.018 : 0.04;
    const dirU = distFree > 0.001 ? duFree / distFree : 0;
    const dirV = distFree > 0.001 ? dvFree / distFree : 0;
    const curlWave =
      Math.sin(timeSec * 0.82 + ball.u * 6 + ball.breathPhase) * 0.65 +
      Math.cos(timeSec * 1.12 - ball.v * 7 - ball.breathPhase) * 0.35;
    const curlStrength = ball.mode === 'wander' ? 0.07 : ball.mode === 'glide' ? 0.095 : 0.025;
    const freeAccelU = dirU * pull - dirV * curlStrength * ball.curlSign * curlWave;
    const freeAccelV = dirV * pull + dirU * curlStrength * ball.curlSign * curlWave;

    // 2. Smooth orbital spring-damper acceleration around "ToniVecherRadio"
    let orbitAccelU = 0;
    let orbitAccelV = 0;
    if (orbitBlend > 0.002) {
      const phase = worldState.orbitAngle + ball.id * Math.PI;
      const desiredU = worldState.titleU + Math.cos(phase) * worldState.titleRxU;
      const desiredV = worldState.titleV + Math.sin(phase) * worldState.titleRyV;
      // Tangent velocity of the moving orbital target for silky, lag-free tracking
      const omega = 0.52;
      const desiredVu = -Math.sin(phase) * worldState.titleRxU * omega;
      const desiredVv = Math.cos(phase) * worldState.titleRyV * omega;
      const kp = 3.2;
      const kd = 2.6;
      orbitAccelU = (desiredU - ball.u) * kp + (desiredVu - ball.vu) * kd;
      orbitAccelV = (desiredV - ball.v) * kp + (desiredVv - ball.vv) * kd;
    }

    // Smoothly blend free drift and orbital choreography without any sudden velocity jump
    const accelU = lerp(freeAccelU, orbitAccelU, orbitBlend);
    const accelV = lerp(freeAccelV, orbitAccelV, orbitBlend);

    const dragPow = lerp(0.32, 0.82, orbitBlend);
    ball.vu = (ball.vu + accelU * dt) * Math.pow(dragPow, dt);
    ball.vv = (ball.vv + accelV * dt) * Math.pow(dragPow, dt);

    const maxSpd = lerp(maxFreeSpd, 0.24, orbitBlend);
    const spd = Math.hypot(ball.vu, ball.vv);
    if (spd > maxSpd) {
      ball.vu = (ball.vu / spd) * maxSpd;
      ball.vv = (ball.vv / spd) * maxSpd;
    }

    ball.u += ball.vu * dt;
    ball.v += ball.vv * dt;

    // Soft elastic screen boundaries (never hard-clamped jank)
    if (ball.u < 0.08) {
      ball.u = 0.08;
      if (ball.vu < 0) ball.vu = -ball.vu * 0.72;
    } else if (ball.u > 0.92) {
      ball.u = 0.92;
      if (ball.vu > 0) ball.vu = -ball.vu * 0.72;
    }
    if (ball.v < 0.09) {
      ball.v = 0.09;
      if (ball.vv < 0) ball.vv = -ball.vv * 0.72;
    } else if (ball.v > 0.7) {
      ball.v = 0.7;
      if (ball.vv > 0) ball.vv = -ball.vv * 0.72;
    }
  }

  // Smooth spin relaxation
  const targetSpin =
    ball.baseSpin +
    (ball.baseSpin >= 0 ? 1 : -1) * (audioLevel * 0.2 + orbitBlend * 0.22);
  ball.spinSpeed += (targetSpin - ball.spinSpeed) * (1 - Math.exp(-dt * 2.4));
  ball.spinAngle += ball.spinSpeed * dt;
  ball.collisionGlow *= Math.exp(-dt * 2.8);
}

/**
 * Soft elastic spring-bounce collision between the two globes in isotropic pixel space.
 */
function resolveGlobeCollision(dt: number, viewportW: number, viewportH: number): void {
  const [a, b] = worldState.globes;
  const ax = a.u * viewportW;
  const ay = a.v * viewportH;
  const bx = b.u * viewportW;
  const by = b.v * viewportH;

  let dx = bx - ax;
  let dy = by - ay;
  let dist = Math.hypot(dx, dy);
  const minDist = a.screenRadius + b.screenRadius + 10;

  if (dist >= minDist) return;

  if (dist < 0.001) {
    dx = 1;
    dy = 0;
    dist = 1;
  }

  const nx = dx / dist;
  const ny = dy / dist;
  const overlapPx = minDist - dist;
  const overlapRatio = clamp01(overlapPx / minDist);

  // Convert velocities to pixels/sec for physically symmetric spring bounce
  const vax = a.vu * viewportW;
  const vay = a.vv * viewportH;
  const vbx = b.vu * viewportW;
  const vby = b.vv * viewportH;

  const relVn = (vbx - vax) * nx + (vby - vay) * ny;

  // Soft spring cushion acceleration + gentle elastic impulse when approaching
  const springAccelPx = (140 + overlapRatio * 420) * overlapRatio;
  const impulsePx = relVn < 0 ? -(1 + 0.84) * relVn * 0.5 : 0;

  const pushPx = overlapPx * Math.min(0.45, dt * 11);

  if (a.isDragging && !b.isDragging) {
    // Player is pushing globe B with globe A
    const deltaV = (impulsePx * 1.45 + springAccelPx * dt) * 1.15;
    b.vu += (nx * deltaV) / viewportW;
    b.vv += (ny * deltaV) / viewportH;
    b.u = Math.max(0.08, Math.min(0.92, b.u + (nx * pushPx) / viewportW));
    b.v = Math.max(0.09, Math.min(0.74, b.v + (ny * pushPx) / viewportH));
    b.mode = 'flung';
    b.nextDecisionSec = Math.max(b.nextDecisionSec, worldState.lastStepSec + 1.8);
    b.personalOrbitPauseUntil = Math.max(b.personalOrbitPauseUntil, worldState.lastStepSec + 2.4);
  } else if (b.isDragging && !a.isDragging) {
    // Player is pushing globe A with globe B
    const deltaV = (impulsePx * 1.45 + springAccelPx * dt) * 1.15;
    a.vu -= (nx * deltaV) / viewportW;
    a.vv -= (ny * deltaV) / viewportH;
    a.u = Math.max(0.08, Math.min(0.92, a.u - (nx * pushPx) / viewportW));
    a.v = Math.max(0.09, Math.min(0.74, a.v - (ny * pushPx) / viewportH));
    a.mode = 'flung';
    a.nextDecisionSec = Math.max(a.nextDecisionSec, worldState.lastStepSec + 1.8);
    a.personalOrbitPauseUntil = Math.max(a.personalOrbitPauseUntil, worldState.lastStepSec + 2.4);
  } else if (!a.isDragging && !b.isDragging) {
    const deltaV = impulsePx + springAccelPx * dt;
    a.vu -= (nx * deltaV) / viewportW;
    a.vv -= (ny * deltaV) / viewportH;
    b.vu += (nx * deltaV) / viewportW;
    b.vv += (ny * deltaV) / viewportH;

    const halfPush = pushPx * 0.5;
    a.u = Math.max(0.08, Math.min(0.92, a.u - (nx * halfPush) / viewportW));
    a.v = Math.max(0.09, Math.min(0.74, a.v - (ny * halfPush) / viewportH));
    b.u = Math.max(0.08, Math.min(0.92, b.u + (nx * halfPush) / viewportW));
    b.v = Math.max(0.09, Math.min(0.74, b.v + (ny * halfPush) / viewportH));
  }

  // Gentle tactile glow + slight spin nudge on contact
  const impactGlow = Math.min(1, 0.35 + overlapRatio * 0.9);
  a.collisionGlow = Math.max(a.collisionGlow, impactGlow);
  b.collisionGlow = Math.max(b.collisionGlow, impactGlow);
  if (relVn < -18) {
    a.spinSpeed += (a.baseSpin >= 0 ? 0.14 : -0.14);
    b.spinSpeed += (b.baseSpin >= 0 ? 0.14 : -0.14);
  }
}

/**
 * Smoothly steers both ASCII globes around the two dancing figures above "T" and "o"
 * so the globes gracefully arc around them without overlapping or snapping.
 */
function resolveDancerAvoidance(dt: number, viewportW: number, viewportH: number): void {
  const obstacles = worldState.dancerObstacles;
  if (obstacles.length === 0 || viewportW <= 0 || viewportH <= 0) return;

  for (const ball of worldState.globes) {
    if (ball.isDragging) continue;

    let bx = ball.u * viewportW;
    let by = ball.v * viewportH;
    let vx = ball.vu * viewportW;
    let vy = ball.vv * viewportH;

    for (const obs of obstacles) {
      const ox = obs.u * viewportW;
      const oy = obs.v * viewportH;
      let dx = bx - ox;
      let dy = by - oy;
      let dist = Math.hypot(dx, dy);

      const hardRadius = ball.screenRadius + obs.radiusPx + 14;
      const softRadius = hardRadius + 38;
      if (dist >= softRadius) continue;

      if (dist < 0.001) {
        dx = ball.id === 0 ? 1 : -1;
        dy = -0.5;
        dist = Math.hypot(dx, dy);
      }

      const nx = dx / dist;
      const ny = dy / dist;
      const proximity = clamp01((softRadius - dist) / (softRadius - hardRadius));

      // Gentle radial cushion + tangential glide so the globe arcs gracefully around the dancer
      const tx = -ny;
      const ty = nx;
      const tangentSign = vx * tx + vy * ty >= 0 ? 1 : -1;
      const steerAccelPx = (75 + proximity * 240) * proximity;
      const glideAccelPx = (48 + proximity * 95) * proximity * tangentSign;

      vx += (nx * steerAccelPx + tx * glideAccelPx) * dt;
      vy += (ny * steerAccelPx + ty * glideAccelPx) * dt;

      // Hard clearance guard: never let the globe overlap a dancer's body
      if (dist < hardRadius) {
        const overlap = hardRadius - dist;
        const vn = vx * nx + vy * ny;
        if (vn < 0) {
          vx -= nx * vn * 1.25;
          vy -= ny * vn * 1.25;
        }
        const push = overlap * Math.min(0.55, dt * 14);
        bx += nx * push;
        by += ny * push;

        // If the globe's autonomous target sits inside the dancer's zone, nudge it clear
        const tdx = ball.targetU * viewportW - ox;
        const tdy = ball.targetV * viewportH - oy;
        if (Math.hypot(tdx, tdy) < softRadius) {
          ball.targetU = Math.max(0.1, Math.min(0.9, (ox + nx * (softRadius + 40)) / viewportW));
          ball.targetV = Math.max(0.1, Math.min(0.66, (oy + ny * (softRadius + 40)) / viewportH));
        }
      }
    }

    ball.u = Math.max(0.08, Math.min(0.92, bx / viewportW));
    ball.v = Math.max(0.09, Math.min(0.72, by / viewportH));
    ball.vu = vx / viewportW;
    ball.vv = vy / viewportH;
  }
}

function renderSingleGlobe(
  ctx: CanvasRenderingContext2D,
  ball: GlobeBody,
  opts: {
    cx: number;
    cy: number;
    radius: number;
    width: number;
    height: number;
    cellStep: number;
    animate: boolean;
    timeSec: number;
    glitchStrength: number;
    beatSwell: number;
    skyHarmRgb: Rgb;
    sampleSkyMask: (px: number, py: number) => number;
  }
): void {
  const {
    cx,
    cy,
    radius,
    width,
    height,
    cellStep,
    animate,
    timeSec,
    glitchStrength,
    beatSwell,
    skyHarmRgb,
    sampleSkyMask,
  } = opts;

  const palette = ball.palette;
  const halfCell = cellStep * 0.5;
  const tileOverlap = cellStep + 0.6;
  const spin = animate ? ball.spinAngle : ball.id === 0 ? 1.1 : 3.9;
  const cloudSpin = spin * 1.24;
  const cosSpin = Math.cos(spin);
  const sinSpin = Math.sin(spin);

  // Soft celestial atmospheric corona breathing in channel tempo + soft collision bloom
  const [ar, ag, ab] = palette.atmosphere;
  const glowBoost = ball.collisionGlow * 0.18 + (ball.isDragging ? 0.08 : 0);
  const haloRadius = radius * (1.28 + (animate ? beatSwell * 0.05 : 0) + ball.collisionGlow * 0.08);
  const halo = ctx.createRadialGradient(cx, cy, radius * 0.72, cx, cy, haloRadius);
  halo.addColorStop(
    0,
    `rgba(${Math.round(ar)},${Math.round(ag)},${Math.round(ab)},${Math.min(0.55, 0.28 + beatSwell * 0.08 + glowBoost).toFixed(3)})`
  );
  halo.addColorStop(
    0.65,
    `rgba(${Math.round(ar)},${Math.round(ag)},${Math.round(ab)},${Math.min(0.24, 0.09 + beatSwell * 0.04 + glowBoost * 0.4).toFixed(3)})`
  );
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
  ctx.fill();

  // Flush-tiled voxel blocks + crisp illuminated ASCII glyphs on 3D sphere
  ctx.globalCompositeOperation = 'source-over';
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

    const rowSeed = Math.sin((py + tickGlitch * 13 + ball.id * 37) * 19.37) * 43758.5453;
    const rowJitterX =
      glitchStrength > 0.2 && rowSeed - Math.floor(rowSeed) > 0.89
        ? Math.round((rowSeed - Math.floor(rowSeed) - 0.945) * 70)
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

      let baseRgb: Rgb;
      let glyph = '~';
      let litScale = 0.26 + diffuse * 0.9;

      if (isCloud) {
        baseRgb = palette.clouds;
        glyph = cloudCurl > 0.72 ? '▓' : cloudCurl > 0.62 ? '▒' : '░';
        litScale = 0.32 + diffuse * 0.92;
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
      const shadowBlend = (1 - diffuse) * 0.36;
      const harmR = lerp(litR, palette.shadowTint[0], shadowBlend);
      const harmG = lerp(litG, palette.shadowTint[1], shadowBlend);
      const harmB = lerp(litB, palette.shadowTint[2], shadowBlend);

      const rimStrength = fresnel * (0.58 + ball.collisionGlow * 0.26);
      const finalR = lerp(lerp(harmR, skyHarmRgb[0], 0.12), palette.atmosphere[0] * 1.15, rimStrength);
      const finalG = lerp(lerp(harmG, skyHarmRgb[1], 0.12), palette.atmosphere[1] * 1.15, rimStrength);
      const finalB = lerp(lerp(harmB, skyHarmRgb[2], 0.12), palette.atmosphere[2] * 1.15, rimStrength);

      const drawX = px + rowJitterX;
      const edgeFade = smoothstep(1.0, 0.87, Math.sqrt(rSq) * invRadius);
      const cellAlpha = skyMask * (0.9 + 0.1 * edgeFade);

      ctx.fillStyle = cachedRgba(finalR * 0.62, finalG * 0.62, finalB * 0.62, cellAlpha);
      ctx.fillRect(drawX - halfCell, py - halfCell, tileOverlap, tileOverlap);

      const glyphR = finalR * 1.24;
      const glyphG = finalG * 1.24;
      const glyphB = finalB * 1.24;
      const peak = Math.max(glyphR, glyphG, glyphB);
      const glyphCap = peak > MAX_CHANNEL_BRIGHTNESS ? MAX_CHANNEL_BRIGHTNESS / peak : 1;
      ctx.fillStyle = cachedRgba(
        glyphR * glyphCap,
        glyphG * glyphCap,
        glyphB * glyphCap,
        Math.min(1, cellAlpha * 1.05)
      );
      ctx.fillText(glyph, drawX, py);
    }
  }
}

/**
 * Draws the paired interactive ASCII Globes in the active tab's color harmony,
 * with smooth palette crossfading, elastic spring-bounce collisions, periodic 1-minute
 * orbits around the radio title every 400–600 seconds, and full mouse/touch grab & fling.
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

  worldState.viewportW = viewportW;
  worldState.viewportH = viewportH;
  worldState.overscanPx = overscanTopPx;

  const dt =
    worldState.lastStepSec > 0
      ? Math.max(0.004, Math.min(0.08, timeSec - worldState.lastStepSec))
      : 0.016;
  worldState.lastStepSec = timeSec;

  // 1. Smoothly crossfade both globes' palettes into the active channel theme
  const targetPair = resolveTargetPalettePair(profile);
  const paletteAlpha = animate ? 1 - Math.exp(-dt * 2.8) : 1;
  worldState.globes[0].palette = interpolatePalette(
    worldState.globes[0].palette,
    targetPair.primary,
    paletteAlpha
  );
  worldState.globes[1].palette = interpolatePalette(
    worldState.globes[1].palette,
    targetPair.secondary,
    paletteAlpha
  );

  // 2. Periodic 400–600s -> 60s orbit schedule around "ToniVecherRadio"
  if (!worldState.orbitInitialized) {
    worldState.orbitInitialized = true;
    worldState.nextOrbitStartSec = timeSec + randomOrbitWaitSec();
    worldState.orbitEndSec = 0;
  }

  let globalOrbitSmooth = 0;
  if (animate) {
    if (timeSec >= worldState.nextOrbitStartSec) {
      worldState.orbitEndSec = timeSec + ORBIT_DURATION_SEC;
      worldState.nextOrbitStartSec = worldState.orbitEndSec + randomOrbitWaitSec();
      // Align orbital angle smoothly with globe 0's current bearing from the title so entry has zero snap
      worldState.orbitAngle = Math.atan2(
        worldState.globes[0].v - worldState.titleV,
        worldState.globes[0].u - worldState.titleU
      );
    }

    const inOrbitWindow = timeSec < worldState.orbitEndSec;
    const prevRaw = worldState.orbitRawBlend;
    const blendStep = dt / ORBIT_TRANSITION_SEC;
    worldState.orbitRawBlend = clamp01(
      worldState.orbitRawBlend + (inOrbitWindow ? blendStep : -blendStep)
    );
    globalOrbitSmooth = smoothstep(0, 1, worldState.orbitRawBlend);

    // When leaving orbit window, assign gentle free-roam destinations so they coast outward naturally
    if (prevRaw > 0.5 && worldState.orbitRawBlend <= 0.5 && !inOrbitWindow) {
      for (const g of worldState.globes) {
        if (!g.isDragging) {
          pickNewBallTarget(g, timeSec, true);
        }
      }
    }

    if (worldState.orbitRawBlend > 0.001) {
      refreshTitleAnchor(viewportW, viewportH);
      const anchorEase = 1 - Math.exp(-dt * 3.0);
      worldState.titleU += (worldState.titleTargetU - worldState.titleU) * anchorEase;
      worldState.titleV += (worldState.titleTargetV - worldState.titleV) * anchorEase;
      worldState.titleRxU += (worldState.titleTargetRxU - worldState.titleRxU) * anchorEase;
      worldState.titleRyV += (worldState.titleTargetRyV - worldState.titleRyV) * anchorEase;
      worldState.orbitAngle += dt * 0.52;
    }
  }

  // 3. Base responsive radius for both globes
  const baseRadius = isMobile
    ? Math.max(34, Math.min(42, Math.round(viewportW * 0.095)))
    : isTablet
      ? Math.max(48, Math.min(58, Math.round(viewportW * 0.052)))
      : Math.max(54, Math.min(68, Math.round(Math.min(viewportW * 0.048, viewportH * 0.076))));

  const depthPresence = 0.94;
  const radii: [number, number] = [0, 0];
  for (let i = 0; i < 2; i++) {
    const g = worldState.globes[i];
    const breatheScale = animate
      ? 0.95 +
        0.06 * Math.sin(timeSec * 1.05 + g.breathPhase) +
        audioLevel * 0.05 +
        (g.isDragging ? 0.07 : 0)
      : 1;
    const r = Math.max(
      22,
      Math.round(baseRadius * g.radiusScale * breatheScale * (1 + Math.max(0, scale - 1) * 0.3))
    );
    radii[i] = r;
    g.screenRadius = r;
  }

  // 4. Step kinematics + soft elastic ball-to-ball collision + dancer avoidance
  if (animate) {
    refreshDancerObstacles(viewportW, viewportH);
    stepSingleGlobe(worldState.globes[0], dt, timeSec, audioLevel, globalOrbitSmooth);
    stepSingleGlobe(worldState.globes[1], dt, timeSec, audioLevel, globalOrbitSmooth);
    resolveGlobeCollision(dt, viewportW, viewportH);
    resolveDancerAvoidance(dt, viewportW, viewportH);
  } else {
    worldState.globes[0].u = 0.76;
    worldState.globes[0].v = 0.22;
    worldState.globes[1].u = 0.24;
    worldState.globes[1].v = 0.29;
  }

  const centers: Array<{ cx: number; cy: number }> = [
    {
      cx: Math.round(overscanTopPx + worldState.globes[0].u * viewportW),
      cy: Math.round(overscanTopPx + worldState.globes[0].v * viewportH),
    },
    {
      cx: Math.round(overscanTopPx + worldState.globes[1].u * viewportW),
      cy: Math.round(overscanTopPx + worldState.globes[1].v * viewportH),
    },
  ];

  for (let i = 0; i < 2; i++) {
    worldState.globes[i].screenCx = centers[i].cx - overscanTopPx;
    worldState.globes[i].screenCy = centers[i].cy - overscanTopPx;
  }

  const cellStep = isMobile ? 6 : 7;
  const skyHarmRgb = parseHexRgb(profile.tintHex);
  const beatSwell = animate
    ? Math.pow(0.5 + 0.5 * Math.sin(timeSec * (profile.grooveBpm / 120) * Math.PI * 2), 1.6)
    : 0.5;

  const sampleSkyMask = (px: number, py: number): number => {
    const sx = Math.max(0, Math.min(sampleCols - 1, Math.floor((px / width) * sampleCols)));
    const sy = Math.max(0, Math.min(sampleRows - 1, Math.floor((py / height) * sampleRows)));
    const idx = (sy * sampleCols + sx) * 4;
    const lum = (54 * pixels[idx] + 183 * pixels[idx + 1] + 19 * pixels[idx + 2]) / 65280;
    return (0.56 + 0.44 * smoothstep(0.08, 0.3, lum)) * depthPresence;
  };

  ctx.save();

  // Subtle deep-cosmos upper sky veil tinted to the active tab
  const [sr, sg, sb] = worldState.globes[0].palette.shadowTint;
  const cosmosBottom = overscanTopPx + viewportH * 0.34;
  const cosmosVeil = ctx.createLinearGradient(0, overscanTopPx, 0, cosmosBottom);
  cosmosVeil.addColorStop(0, `rgba(${Math.round(sr)},${Math.round(sg)},${Math.round(sb)},0.2)`);
  cosmosVeil.addColorStop(0.55, `rgba(${Math.round(sr)},${Math.round(sg)},${Math.round(sb)},0.07)`);
  cosmosVeil.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = cosmosVeil;
  ctx.fillRect(0, 0, width, cosmosBottom);

  // Subtle distant ASCII stars near either globe
  ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const starPalette = worldState.globes[0].palette.clouds;
  for (let i = 0; i < COSMOS_STARS.length; i++) {
    const star = COSMOS_STARS[i];
    const sx = overscanTopPx + star.u * viewportW;
    const sy = overscanTopPx + star.v * viewportH;
    const d0 = Math.hypot(sx - centers[0].cx, sy - centers[0].cy);
    const d1 = Math.hypot(sx - centers[1].cx, sy - centers[1].cy);
    const near0 = d0 >= radii[0] * 1.1 && d0 <= radii[0] * 2.4;
    const near1 = d1 >= radii[1] * 1.1 && d1 <= radii[1] * 2.4;
    if (!near0 && !near1) continue;
    const skyMask = sampleSkyMask(sx, sy);
    if (skyMask < 0.25) continue;
    const twinkle = animate ? 0.55 + 0.45 * Math.sin(timeSec * 1.8 + star.phase) : 0.75;
    ctx.globalAlpha = skyMask * 0.42 * twinkle;
    ctx.fillStyle = cachedRgba(starPalette[0], starPalette[1], starPalette[2]);
    ctx.fillText(star.glyph, sx, sy);
  }
  ctx.globalAlpha = 1;

  // Render both globes (dragged globe drawn on top for crisp tactile layering)
  ctx.font = `700 ${cellStep + 1}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const drawOrder: [0 | 1, 0 | 1] = worldState.globes[0].isDragging ? [1, 0] : [0, 1];
  for (const idx of drawOrder) {
    renderSingleGlobe(ctx, worldState.globes[idx], {
      cx: centers[idx].cx,
      cy: centers[idx].cy,
      radius: radii[idx],
      width,
      height,
      cellStep,
      animate,
      timeSec,
      glitchStrength,
      beatSwell,
      skyHarmRgb,
      sampleSkyMask,
    });
  }

  ctx.restore();
}
