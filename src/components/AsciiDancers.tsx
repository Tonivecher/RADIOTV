import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { getReactiveAudioEnergy } from '../audio/reactiveTelemetry';
import { resolveChannelAsciiProfile } from '../constants/ascii';

interface AsciiDancersProps {
  channelId: string;
}

type Rgb = [number, number, number];
interface V3 {
  x: number;
  y: number;
  z: number;
}
interface Limb {
  a1: number;
  f1: number;
  a2: number;
  f2: number;
}
interface Pose {
  hipX: number;
  hop: number;
  lean: number;
  shoulderYaw: number;
  hipYaw: number;
  globalYaw: number;
  headTilt: number;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
}
interface DancerPalette {
  head: Rgb;
  arms: Rgb;
  body: Rgb;
  legs: Rgb;
  accent: Rgb;
}

const hex = (value: string): Rgb => {
  const n = Number.parseInt(value.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Volumetric tones drawn from the channel themes (each dancer pair mirrors the two globes).
const PALETTES: Record<string, { left: DancerPalette; right: DancerPalette; glow: string }> = {
  'ch-main': {
    left: {
      head: hex('#fde0b6'),
      arms: hex('#f5b878'),
      body: hex('#e88b48'),
      legs: hex('#d9a066'),
      accent: hex('#fff1d0'),
    },
    right: {
      head: hex('#e2f2d8'),
      arms: hex('#a6d4a8'),
      body: hex('#78bd8e'),
      legs: hex('#9bbfd8'),
      accent: hex('#f8e6b8'),
    },
    glow: 'rgba(234, 185, 138, 0.55)',
  },
  'ch-deep': {
    left: {
      head: hex('#ffd0ca'),
      arms: hex('#f4a39c'),
      body: hex('#e8625c'),
      legs: hex('#d98a92'),
      accent: hex('#ffebe0'),
    },
    right: {
      head: hex('#fce4c8'),
      arms: hex('#f0b48e'),
      body: hex('#e69a68'),
      legs: hex('#d98878'),
      accent: hex('#fff0d8'),
    },
    glow: 'rgba(232, 137, 128, 0.55)',
  },
  'ch-afterglow': {
    left: {
      head: hex('#e6dcff'),
      arms: hex('#c3aefc'),
      body: hex('#9c80f4'),
      legs: hex('#84a8ee'),
      accent: hex('#f6ecff'),
    },
    right: {
      head: hex('#fce4c4'),
      arms: hex('#f0bf94'),
      body: hex('#e4a070'),
      legs: hex('#b49ee0'),
      accent: hex('#fff2d8'),
    },
    glow: 'rgba(189, 168, 242, 0.55)',
  },
};

const COLS = 26;
const ROWS = 38;
const SS = 3; // supersampling before the volume is converted to glyphs
const GROUND_Y = ROWS - 3.2;
const HIP_BASE_Y = 21;
const RAMP = ['.', ':', '-', '=', '+', '*', '#', '%', '@'];
const LIGHT = { x: -0.55, y: -0.83 };

const limb = (a1: number, f1: number, a2: number, f2: number): Limb => ({ a1, f1, a2, f2 });
const dirOf = (a: number, f: number): V3 => ({
  x: Math.sin(a) * Math.cos(f),
  y: Math.cos(a) * Math.cos(f),
  z: Math.sin(f),
});
const along = (p: V3, d: V3, len: number): V3 => ({
  x: p.x + d.x * len,
  y: p.y + d.y * len,
  z: p.z + d.z * len,
});
const rotY = (p: V3, g: number): V3 => {
  const c = Math.cos(g);
  const s = Math.sin(g);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
};
const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const tone = (c: Rgb, f: number) => `rgb(${clamp255(c[0] * f)},${clamp255(c[1] * f)},${clamp255(c[2] * f)})`;

// Dancer A: pumping arms, marching knees, hip twist.
function poseA(p: number, amp: number): Pose {
  const s = Math.sin(Math.PI * p);
  const c = Math.cos(Math.PI * p);
  const b = Math.abs(s);
  const half = Math.sin(Math.PI * p * 0.5);
  const liftL = Math.max(0, s);
  const liftR = Math.max(0, -s);
  return {
    hipX: half * 1.2 * amp,
    hop: b * 1.1 * amp,
    lean: half * 0.1 * amp,
    shoulderYaw: half * 0.55 * amp,
    hipYaw: -half * 0.3 * amp,
    globalYaw: Math.sin(Math.PI * p * 0.25) * 0.32,
    headTilt: c * 0.12 * amp,
    armL: limb(-(2.35 + 0.45 * s * amp), 0.12, -(2.9 + 0.55 * b * amp), 0.2),
    armR: limb(2.35 - 0.45 * s * amp, 0.12, 2.9 + 0.55 * (1 - b) * amp, 0.2),
    legL: limb(-0.17, 0.9 * liftL * amp, -0.1, (0.9 - 1.5) * liftL * amp - 0.04),
    legR: limb(0.17, 0.9 * liftR * amp, 0.1, (0.9 - 1.5) * liftR * amp - 0.04),
  };
}

// Dancer B: bouncy knees, flowing arm waves, shoulder roll.
function poseB(p: number, amp: number): Pose {
  const s = Math.sin(Math.PI * p);
  const b = Math.abs(s);
  const sq = 0.5 + 0.5 * Math.cos(2 * Math.PI * p);
  const wave = Math.sin(Math.PI * p);
  const half = Math.sin(Math.PI * p * 0.5 + 1);
  return {
    hipX: -half * 1.0 * amp,
    hop: (1 - sq) * 0.7 * amp,
    lean: -half * 0.09 * amp,
    shoulderYaw: half * 0.5 * amp,
    hipYaw: -half * 0.35 * amp,
    globalYaw: Math.sin(Math.PI * p * 0.25 + 2) * 0.3,
    headTilt: s * 0.16 * amp,
    armL: limb(-(1.35 + 0.4 * wave * amp), 0.2, -(1.35 + 0.4 * wave * amp) - 0.75 * Math.sin(Math.PI * p + 1.2) * amp - 0.35, 0.1),
    armR: limb(1.35 - 0.4 * wave * amp, 0.2, 1.35 - 0.4 * wave * amp + 0.75 * Math.sin(Math.PI * p + 1.2) * amp + 0.35, 0.1),
    legL: limb(-(0.3 + 0.12 * sq), 0.4 * sq * amp, -(0.12 + 0.05 * b), -0.85 * sq * amp),
    legR: limb(0.3 + 0.12 * sq, 0.4 * sq * amp, 0.12 + 0.05 * b, -0.85 * sq * amp),
  };
}

interface Projected {
  x: number;
  y: number;
  z: number;
  k: number;
}

interface DrawItem {
  z: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

function buildFigure(pose: Pose, pal: DancerPalette): { items: DrawItem[]; hop: number } {
  const hipR = (sx: number): V3 => rotY({ x: sx * 1.9, y: 0, z: 0 }, pose.hipYaw);
  const leanX = Math.sin(pose.lean);
  const leanY = Math.cos(pose.lean);
  const neckBase: V3 = { x: leanX * 8.2, y: -leanY * 8.2, z: 0 };
  const shoulderOff = (sx: number): V3 => rotY({ x: sx * 3.3, y: 0, z: 0 }, pose.shoulderYaw);
  const sOffL = shoulderOff(-1);
  const sOffR = shoulderOff(1);
  const sL: V3 = { x: neckBase.x + sOffL.x, y: neckBase.y, z: sOffL.z };
  const sR: V3 = { x: neckBase.x + sOffR.x, y: neckBase.y, z: sOffR.z };
  const hL = hipR(-1);
  const hR = hipR(1);

  const elbowL = along(sL, dirOf(pose.armL.a1, pose.armL.f1), 5);
  const wristL = along(elbowL, dirOf(pose.armL.a2, pose.armL.f2), 4.7);
  const elbowR = along(sR, dirOf(pose.armR.a1, pose.armR.f1), 5);
  const wristR = along(elbowR, dirOf(pose.armR.a2, pose.armR.f2), 4.7);
  const kneeL = along(hL, dirOf(pose.legL.a1, pose.legL.f1), 6.4);
  const ankleL = along(kneeL, dirOf(pose.legL.a2, pose.legL.f2), 6.4);
  const kneeR = along(hR, dirOf(pose.legR.a1, pose.legR.f1), 6.4);
  const ankleR = along(kneeR, dirOf(pose.legR.a2, pose.legR.f2), 6.4);
  const toeL = { x: ankleL.x - 0.9, y: ankleL.y + 0.7, z: ankleL.z + 1.9 };
  const toeR = { x: ankleR.x + 0.9, y: ankleR.y + 0.7, z: ankleR.z + 1.9 };

  const neckTop: V3 = { x: neckBase.x + Math.sin(pose.headTilt) * 1.6, y: neckBase.y - 1.7, z: 0 };
  const head: V3 = {
    x: neckTop.x + Math.sin(pose.headTilt) * 2.5,
    y: neckTop.y - 2.6 * Math.cos(pose.headTilt),
    z: 0.3,
  };

  const world = (p: V3): V3 => {
    const r = rotY(p, pose.globalYaw);
    return { x: r.x + pose.hipX, y: r.y, z: r.z };
  };
  const W = {
    sL: world(sL), sR: world(sR), hL: world(hL), hR: world(hR),
    eL: world(elbowL), eR: world(elbowR), wL: world(wristL), wR: world(wristR),
    kL: world(kneeL), kR: world(kneeR), aL: world(ankleL), aR: world(ankleR),
    tL: world(toeL), tR: world(toeR), nb: world(neckBase), head: world(head),
    hip: world({ x: 0, y: 0, z: 0 }),
  };

  // Plant the lower foot on the floor; `hop` lifts the whole body on the beat.
  const lowest = Math.max(W.aL.y, W.aR.y, W.tL.y, W.tR.y);
  const dy = GROUND_Y - HIP_BASE_Y - lowest - pose.hop;
  const cx = COLS / 2;
  const proj = (p: V3): Projected => {
    const k = 1 / (1 - p.z * 0.016);
    return { x: cx + p.x * k, y: HIP_BASE_Y + (p.y + dy) * k, z: p.z, k };
  };

  const depthShade = (z: number) => Math.max(0.62, Math.min(1.18, 0.9 + z * 0.035));
  const items: DrawItem[] = [];

  const sphere = (p: Projected, r: number, col: Rgb) => {
    items.push({
      z: p.z,
      draw: (ctx) => {
        const rr = r * p.k;
        const df = depthShade(p.z);
        const g = ctx.createRadialGradient(p.x + LIGHT.x * rr * 0.55, p.y + LIGHT.y * rr * 0.55, rr * 0.08, p.x, p.y, rr);
        g.addColorStop(0, tone(col, 1.55 * df));
        g.addColorStop(0.5, tone(col, 1 * df));
        g.addColorStop(1, tone(col, 0.5 * df));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.fill();
      },
    });
  };

  const capsule = (a: Projected, b: Projected, r1: number, r2: number, col: Rgb) => {
    items.push({
      z: (a.z + b.z) / 2,
      draw: (ctx) => {
        const ra = r1 * a.k;
        const rb = r2 * b.k;
        const dx = b.x - a.x;
        const dyy = b.y - a.y;
        const len = Math.hypot(dx, dyy);
        const df = depthShade((a.z + b.z) / 2);
        if (len < 0.05) {
          ctx.fillStyle = tone(col, df);
          ctx.beginPath();
          ctx.arc(a.x, a.y, Math.max(ra, rb), 0, Math.PI * 2);
          ctx.fill();
          return;
        }
        let nx = -dyy / len;
        let ny = dx / len;
        if (nx * LIGHT.x + ny * LIGHT.y < 0) {
          nx = -nx;
          ny = -ny;
        }
        const rm = Math.max(ra, rb);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const g = ctx.createLinearGradient(mx + nx * rm, my + ny * rm, mx - nx * rm, my - ny * rm);
        g.addColorStop(0, tone(col, 1.55 * df));
        g.addColorStop(0.38, tone(col, 1.02 * df));
        g.addColorStop(1, tone(col, 0.42 * df));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
        ctx.lineTo(b.x + nx * rb, b.y + ny * rb);
        ctx.lineTo(b.x - nx * rb, b.y - ny * rb);
        ctx.lineTo(a.x - nx * ra, a.y - ny * ra);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(a.x, a.y, ra, 0, Math.PI * 2);
        ctx.arc(b.x, b.y, rb, 0, Math.PI * 2);
        ctx.fill();
      },
    });
  };

  const P = {
    hip: proj(W.hip), nb: proj(W.nb), head: proj(W.head),
    sL: proj(W.sL), sR: proj(W.sR), hL: proj(W.hL), hR: proj(W.hR),
    eL: proj(W.eL), eR: proj(W.eR), wL: proj(W.wL), wR: proj(W.wR),
    kL: proj(W.kL), kR: proj(W.kR), aL: proj(W.aL), aR: proj(W.aR),
    tL: proj(W.tL), tR: proj(W.tR),
  };

  // Legs
  capsule(P.hL, P.kL, 1.7, 1.35, pal.legs);
  capsule(P.kL, P.aL, 1.35, 1.0, pal.legs);
  capsule(P.aL, P.tL, 1.05, 0.85, pal.accent);
  capsule(P.hR, P.kR, 1.7, 1.35, pal.legs);
  capsule(P.kR, P.aR, 1.35, 1.0, pal.legs);
  capsule(P.aR, P.tR, 1.05, 0.85, pal.accent);
  // Torso
  capsule(P.hip, P.nb, 2.4, 3.1, pal.body);
  // Arms
  sphere(P.sL, 1.45, pal.arms);
  sphere(P.sR, 1.45, pal.arms);
  capsule(P.sL, P.eL, 1.2, 1.0, pal.arms);
  capsule(P.eL, P.wL, 1.0, 0.85, pal.arms);
  sphere(P.wL, 1.15, pal.head);
  capsule(P.sR, P.eR, 1.2, 1.0, pal.arms);
  capsule(P.eR, P.wR, 1.0, 0.85, pal.arms);
  sphere(P.wR, 1.15, pal.head);
  // Head + headphones
  sphere(P.head, 2.75, pal.head);
  const headYaw = pose.globalYaw + pose.shoulderYaw * 0.6;
  const cupL = proj(world({ x: head.x + Math.cos(headYaw) * -2.85, y: head.y + 0.2, z: head.z + Math.sin(headYaw) * 2.85 }));
  const cupR = proj(world({ x: head.x + Math.cos(headYaw) * 2.85, y: head.y + 0.2, z: head.z - Math.sin(headYaw) * 2.85 }));
  sphere(cupL, 1.25, pal.accent);
  sphere(cupR, 1.25, pal.accent);
  items.push({
    z: P.head.z + 0.6,
    draw: (ctx) => {
      ctx.strokeStyle = tone(pal.accent, 1.1);
      ctx.lineWidth = 0.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cupL.x, cupL.y - 0.4);
      ctx.bezierCurveTo(cupL.x, P.head.y - 4.6, cupR.x, P.head.y - 4.6, cupR.x, cupR.y - 0.4);
      ctx.stroke();
    },
  });

  items.sort((a, b) => a.z - b.z);
  // Contact shadow first (lowest depth), it shrinks while the dancer hops.
  const shadowScale = Math.max(0.55, 1 - pose.hop * 0.12);
  items.unshift({
    z: -99,
    draw: (ctx) => {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(cx + pose.hipX * 0.6, GROUND_Y + 0.9, 6.2 * shadowScale, 1.3 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();
    },
  });

  return { items, hop: pose.hop };
}

interface DancerRuntime {
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  hi: HTMLCanvasElement;
  hiCtx: CanvasRenderingContext2D;
  lo: HTMLCanvasElement;
  loCtx: CanvasRenderingContext2D;
  phase: number;
  poseFn: (p: number, amp: number) => Pose;
  side: 'left' | 'right';
}

function createOffscreen(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('2d context unavailable');
  }
  return [c, ctx];
}

function renderDancer(d: DancerRuntime, pal: DancerPalette, amp: number, cell: number, dpr: number): void {
  const pose = d.poseFn(d.phase, amp);
  const { items } = buildFigure(pose, pal);

  d.hiCtx.setTransform(1, 0, 0, 1, 0, 0);
  d.hiCtx.clearRect(0, 0, d.hi.width, d.hi.height);
  d.hiCtx.setTransform(SS, 0, 0, SS, 0, 0);
  for (const item of items) {
    item.draw(d.hiCtx);
  }

  d.loCtx.setTransform(1, 0, 0, 1, 0, 0);
  d.loCtx.clearRect(0, 0, COLS, ROWS);
  d.loCtx.imageSmoothingEnabled = true;
  d.loCtx.imageSmoothingQuality = 'high';
  d.loCtx.drawImage(d.hi, 0, 0, COLS, ROWS);
  const data = d.loCtx.getImageData(0, 0, COLS, ROWS).data;

  const ctx = d.ctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, COLS * cell, ROWS * cell);
  ctx.font = `800 ${(cell * 1.72).toFixed(2)}px "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const o = (j * COLS + i) * 4;
      const a = data[o + 3] / 255;
      if (a < 0.26) continue;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      const idx = Math.max(0, Math.min(RAMP.length - 1, Math.floor(Math.pow(lum, 0.85) * RAMP.length * 1.05)));
      ctx.globalAlpha = Math.min(1, a * 1.25);
      ctx.fillStyle = `rgb(${Math.min(255, Math.round(r * 1.08))},${Math.min(255, Math.round(g * 1.08))},${Math.min(255, Math.round(b * 1.08))})`;
      ctx.fillText(RAMP[idx], (i + 0.5) * cell, (j + 0.56) * cell);
    }
  }
  ctx.globalAlpha = 1;
}

export const AsciiDancers: React.FC<AsciiDancersProps> = ({ channelId }) => {
  const reducedMotion = Boolean(useReducedMotion());
  const leftWrap = useRef<HTMLDivElement | null>(null);
  const rightWrap = useRef<HTMLDivElement | null>(null);
  const leftCanvas = useRef<HTMLCanvasElement | null>(null);
  const rightCanvas = useRef<HTMLCanvasElement | null>(null);

  const colors = PALETTES[channelId] || PALETTES['ch-main'];

  useEffect(() => {
    const lw = leftWrap.current;
    const rw = rightWrap.current;
    const lc = leftCanvas.current;
    const rc = rightCanvas.current;
    if (!lw || !rw || !lc || !rc) return;

    const make = (
      wrapper: HTMLDivElement,
      canvas: HTMLCanvasElement,
      poseFn: DancerRuntime['poseFn'],
      phase: number,
      side: 'left' | 'right'
    ): DancerRuntime | null => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const [hi, hiCtx] = createOffscreen(COLS * SS, ROWS * SS);
      const [lo, loCtx] = createOffscreen(COLS, ROWS);
      return { wrapper, canvas, ctx, hi, hiCtx, lo, loCtx, phase, poseFn, side };
    };

    const dancers = [
      make(lw, lc, poseA, 0, 'left'),
      make(rw, rc, poseB, 1.35, 'right'),
    ].filter((d): d is DancerRuntime => d !== null);
    if (dancers.length === 0) return;

    const profile = resolveChannelAsciiProfile(channelId);
    const beatHz = profile.grooveBpm / 60;
    let cell = 4.2;
    let dpr = 1;

    const layout = () => {
      const mobile = window.matchMedia('(max-width: 760px)').matches;
      cell = mobile ? 3.4 : 4.3;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const d of dancers) {
        d.canvas.width = Math.round(COLS * cell * dpr);
        d.canvas.height = Math.round(ROWS * cell * dpr);
        d.canvas.style.width = `${COLS * cell}px`;
        d.canvas.style.height = `${ROWS * cell}px`;
        d.wrapper.style.setProperty('--dancer-w', `${COLS * cell}px`);
        d.wrapper.style.setProperty('--dancer-h', `${ROWS * cell}px`);
      }
    };
    layout();

    const palFor = (d: DancerRuntime) => (d.side === 'left' ? colors.left : colors.right);

    if (reducedMotion) {
      for (const d of dancers) {
        d.phase += 0.3;
        renderDancer(d, palFor(d), 0.8, cell, dpr);
      }
      window.addEventListener('resize', layout);
      return () => window.removeEventListener('resize', layout);
    }

    let onScreen = true;
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
      },
      { threshold: 0 }
    );
    io.observe(lw);

    let rafId = 0;
    let lastMs = performance.now();
    let lastDraw = 0;

    const tick = (nowMs: number) => {
      rafId = window.requestAnimationFrame(tick);
      if (document.hidden || !onScreen) {
        lastMs = nowMs;
        return;
      }
      const dt = Math.min(0.1, Math.max(0.001, (nowMs - lastMs) * 0.001));
      lastMs = nowMs;
      const energy = getReactiveAudioEnergy(nowMs * 0.001);
      const speed = beatHz * (energy.isPlaying ? 1 + energy.level * 0.28 : 0.92);
      for (const d of dancers) {
        d.phase += dt * speed;
      }
      if (nowMs - lastDraw < 33) return;
      lastDraw = nowMs;
      const amp = energy.isPlaying ? 0.8 + energy.level * 0.5 : 0.62;
      for (const d of dancers) {
        renderDancer(d, palFor(d), amp, cell, dpr);
      }
    };
    rafId = window.requestAnimationFrame(tick);
    window.addEventListener('resize', layout);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', layout);
      io.disconnect();
    };
  }, [channelId, reducedMotion, colors]);

  const glowStyle = { '--dancer-glow': colors.glow } as React.CSSProperties;

  return (
    <>
      <div
        ref={leftWrap}
        className="ascii-dancer ascii-dancer--left"
        data-ascii-dancer="left"
        aria-hidden="true"
        style={glowStyle}
      >
        <canvas ref={leftCanvas} className="ascii-dancer__canvas" />
      </div>
      <div
        ref={rightWrap}
        className="ascii-dancer ascii-dancer--right"
        data-ascii-dancer="right"
        aria-hidden="true"
        style={glowStyle}
      >
        <canvas ref={rightCanvas} className="ascii-dancer__canvas" />
      </div>
    </>
  );
};
