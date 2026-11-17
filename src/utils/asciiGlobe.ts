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
  oceanDeep: [10, 46, 118],
  oceanLit: [26, 162, 248],
  shallows: [45, 228, 212],
  forest: [36, 218, 142],
  savanna: [112, 228, 184],
  highland: [98, 212, 244],
  clouds: [196, 214, 232],
  cityLight: [147, 216, 244],
  atmosphere: [56, 189, 248],
  shadowTint: [5, 7, 13],
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
  atmosphere: [167, 139, 244],
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
  const deepProximity = Math.max(0, 1 - Math.hypot(tr - 56, tg - 189, tb - 248) / 220);
  const techProximity = Math.max(0, 1 - Math.hypot(tr - 167, tg - 139, tb - 250) / 220);
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

/**
 * Draws the colossal spinning voxel-ASCII Earth anchored cleanly in the upper-center visible sky
 * (accounting for any container overscan like `.evening-background__pointer { inset: -44px }`),
 * flush-tiled with Minecraft-rich biome colors and bright ASCII glyphs.
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
  } = opts;

  const viewportW = Math.max(1, width - overscanTopPx * 2);
  const viewportH = Math.max(1, height - overscanTopPx * 2);
  const isMobile = viewportW <= 760;
  const isTablet = viewportW > 760 && viewportW <= 1100;

  // Anchor the globe below the floating island header on every breakpoint (390/760/1100/1440)
  // so header pills never cut across the planet and the full sphere stays unclipped.
  const baseRadius = isMobile
    ? Math.max(46, Math.min(54, Math.round(viewportW * 0.132)))
    : isTablet
      ? Math.max(58, Math.min(68, Math.round(viewportW * 0.072)))
      : Math.max(64, Math.min(76, Math.round(Math.min(viewportW * 0.055, viewportH * 0.082))));
  const radius = Math.round(baseRadius * (1 + Math.max(0, scale - 1) * 0.34));
  const headerClearance = isMobile ? 118 : isTablet ? 138 : 88;
  const cx = Math.round(width * 0.5);
  const cy = Math.round(overscanTopPx + headerClearance + radius);
  const cellStep = isMobile ? 5 : 7;
  const halfCell = cellStep * 0.5;
  const tileOverlap = cellStep + 0.6;

  const palette = resolveGlobePalette(profile);
  const spin = animate ? timeSec * 0.19 : 1.1;
  const cloudSpin = animate ? timeSec * 0.24 : 1.4;
  const cosSpin = Math.cos(spin);
  const sinSpin = Math.sin(spin);
  const skyHarmRgb = parseHexRgb(profile.tintHex);

  const sampleSkyMask = (px: number, py: number): number => {
    const sx = Math.max(0, Math.min(sampleCols - 1, Math.floor((px / width) * sampleCols)));
    const sy = Math.max(0, Math.min(sampleRows - 1, Math.floor((py / height) * sampleRows)));
    const idx = (sy * sampleCols + sx) * 4;
    const lum = (54 * pixels[idx] + 183 * pixels[idx + 1] + 19 * pixels[idx + 2]) / 65280;
    return smoothstep(0.18, 0.38, lum);
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

  // 2. Soft celestial atmospheric corona gently breathing in channel tempo behind Earth's limb
  const [ar, ag, ab] = palette.atmosphere;
  const beatSwell = animate
    ? Math.pow(0.5 + 0.5 * Math.sin(timeSec * (profile.grooveBpm / 120) * Math.PI * 2), 1.6)
    : 0.5;
  const haloRadius = radius * (1.26 + (animate ? beatSwell * 0.05 : 0));
  const halo = ctx.createRadialGradient(cx, cy, radius * 0.72, cx, cy, haloRadius);
  halo.addColorStop(
    0,
    `rgba(${Math.round(ar)},${Math.round(ag)},${Math.round(ab)},${(0.28 + beatSwell * 0.08).toFixed(3)})`
  );
  halo.addColorStop(
    0.65,
    `rgba(${Math.round(ar)},${Math.round(ag)},${Math.round(ab)},${(0.09 + beatSwell * 0.04).toFixed(3)})`
  );
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
  ctx.fill();

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

  ctx.restore();
}
