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
  hairSwing: number;
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
  hair: Rgb;
}

interface BodyStyle {
  shoulderW: number;
  hipW: number;
  torsoLow: number;
  torsoHigh: number;
  headR: number;
  thigh: number;
  ponytail: boolean;
}

const MALE_STYLE: BodyStyle = {
  shoulderW: 3.9,
  hipW: 1.85,
  torsoLow: 2.5,
  torsoHigh: 3.5,
  headR: 2.8,
  thigh: 1.8,
  ponytail: false,
};
const FEMALE_STYLE: BodyStyle = {
  shoulderW: 2.9,
  hipW: 2.35,
  torsoLow: 2.45,
  torsoHigh: 2.3,
  headR: 2.65,
  thigh: 1.65,
  ponytail: true,
};

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
      hair: hex('#8a4a2a'),
    },
    right: {
      head: hex('#e2f2d8'),
      arms: hex('#a6d4a8'),
      body: hex('#78bd8e'),
      legs: hex('#9bbfd8'),
      accent: hex('#f8e6b8'),
      hair: hex('#6b3b25'),
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
      hair: hex('#7a2a35'),
    },
    right: {
      head: hex('#fce4c8'),
      arms: hex('#f0b48e'),
      body: hex('#e69a68'),
      legs: hex('#d98878'),
      accent: hex('#fff0d8'),
      hair: hex('#5a2f1e'),
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
      hair: hex('#4a3a8c'),
    },
    right: {
      head: hex('#fce4c4'),
      arms: hex('#f0bf94'),
      body: hex('#e4a070'),
      legs: hex('#b49ee0'),
      accent: hex('#fff2d8'),
      hair: hex('#6a3a2a'),
    },
    glow: 'rgba(189, 168, 242, 0.55)',
  },
};

const COLS = 32;
const ROWS = 38;
const SS = 3; // supersampling before the volume is converted to glyphs
const GROUND_Y = ROWS - 3.2;
const HIP_BASE_Y = 21;
const RAMP = ['.', ':', '-', '=', '+', '*', '#', '%', '@'];
const LIGHT = { x: -0.55, y: -0.83 };
const THICK = 1.16;

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

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const lerpLimb = (a: Limb, b: Limb, t: number): Limb => ({
  a1: lerp(a.a1, b.a1, t),
  f1: lerp(a.f1, b.f1, t),
  a2: lerp(a.a2, b.a2, t),
  f2: lerp(a.f2, b.f2, t),
});
const blendPose = (a: Pose, b: Pose, t: number): Pose => ({
  hairSwing: lerp(a.hairSwing, b.hairSwing, t),
  hipX: lerp(a.hipX, b.hipX, t),
  hop: lerp(a.hop, b.hop, t),
  lean: lerp(a.lean, b.lean, t),
  shoulderYaw: lerp(a.shoulderYaw, b.shoulderYaw, t),
  hipYaw: lerp(a.hipYaw, b.hipYaw, t),
  globalYaw: lerpAngle(a.globalYaw, b.globalYaw, t),
  headTilt: lerp(a.headTilt, b.headTilt, t),
  armL: lerpLimb(a.armL, b.armL, t),
  armR: lerpLimb(a.armR, b.armR, t),
  legL: lerpLimb(a.legL, b.legL, t),
  legR: lerpLimb(a.legR, b.legR, t),
});

// One full turn on the spot between progress `from` and `to`; `bump` peaks mid-turn (hair / arm flare).
const spin = (u: number, from: number, to: number) => {
  const k = (u - from) / (to - from);
  return { yaw: Math.PI * 2 * smooth(k), bump: k > 0 && k < 1 ? Math.sin(Math.PI * k) : 0 };
};

const legsBounce = (p: number, amp: number, wide: number) => {
  const sq = 0.5 + 0.5 * Math.cos(2 * Math.PI * p);
  return {
    hop: (1 - sq) * 0.7 * amp,
    legL: limb(-(wide + 0.1 * sq), 0.38 * sq * amp, -0.1, -0.75 * sq * amp),
    legR: limb(wide + 0.1 * sq, 0.38 * sq * amp, 0.1, -0.75 * sq * amp),
  };
};
const legsMarch = (p: number, amp: number) => {
  const s = Math.sin(Math.PI * p);
  const liftL = Math.max(0, s);
  const liftR = Math.max(0, -s);
  return {
    hop: Math.abs(s) * 1.0 * amp,
    legL: limb(-0.17, 0.9 * liftL * amp, -0.1, -0.6 * liftL * amp - 0.04),
    legR: limb(0.17, 0.9 * liftR * amp, 0.1, -0.6 * liftR * amp - 0.04),
  };
};
const legsTogether = (p: number, amp: number) => {
  const bob = 0.5 + 0.5 * Math.cos(2 * Math.PI * p);
  return {
    hop: (1 - bob) * 0.9 * amp,
    legL: limb(-0.06, 0.1 * bob, -0.03, -0.18 * bob),
    legR: limb(0.06, 0.1 * bob, 0.03, -0.18 * bob),
  };
};

// Arm that is raised (k=1) or lowered (k=0); the forearm trails for a natural whip.
const armLeft = (k: number, trail: number, flare = 0): Limb => {
  const a1 = -(0.42 + 2.4 * k + flare);
  return limb(a1, 0.1 + 0.25 * (1 - k), a1 - (0.35 + trail) * (0.4 + 0.6 * k) - 0.2 * (1 - k), 0.35 * (1 - k));
};
const armRight = (k: number, trail: number, flare = 0): Limb => {
  const a1 = 0.42 + 2.4 * k + flare;
  return limb(a1, 0.1 + 0.25 * (1 - k), a1 + (0.35 + trail) * (0.4 + 0.6 * k) + 0.2 * (1 - k), 0.35 * (1 - k));
};

type Move = (p: number, u: number, amp: number) => Pose;

const neutral = (): Pose => ({
  hairSwing: 0,
  hipX: 0,
  hop: 0,
  lean: 0,
  shoulderYaw: 0,
  hipYaw: 0,
  globalYaw: 0,
  headTilt: 0,
  armL: armLeft(0, 0),
  armR: armRight(0, 0),
  legL: limb(-0.17, 0, -0.1, 0),
  legR: limb(0.17, 0, 0.1, 0),
});

// ---- He: loud, wide, athletic moves --------------------------------------------------------
const MALE_MOVES: Move[] = [
  // Alternating pump: one hand rockets up while the other drops
  (p, _u, amp) => {
    const s = Math.sin(Math.PI * p);
    const half = Math.sin(Math.PI * p * 0.5);
    const k = 0.5 + 0.5 * s;
    return {
      ...neutral(),
      ...legsMarch(p, amp),
      hairSwing: 0,
      hipX: half * 1.2 * amp,
      lean: half * 0.1 * amp,
      shoulderYaw: half * 0.6 * amp,
      hipYaw: -half * 0.3 * amp,
      globalYaw: Math.sin(Math.PI * p * 0.25) * 0.4,
      headTilt: Math.cos(Math.PI * p) * 0.14 * amp,
      armL: armLeft(k, 0.2 * s),
      armR: armRight(1 - k, -0.2 * s),
    };
  },
  // Disco point: diagonal arm up, opposite arm low, held for two beats, then switch
  (p, _u, amp) => {
    const m = Math.sin(Math.PI * p * 0.5);
    const k = smooth(0.5 + m * 0.9);
    const b = Math.abs(Math.sin(Math.PI * p));
    return {
      ...neutral(),
      ...legsBounce(p, amp, 0.3),
      hipX: m * 1.5 * amp,
      lean: m * 0.14 * amp,
      shoulderYaw: m * 0.4 * amp,
      hipYaw: -m * 0.5 * amp,
      globalYaw: m * 0.5,
      headTilt: m * 0.18,
      armL: armLeft(1 - k, 0.3 * b),
      armR: armRight(k, 0.3 * b),
    };
  },
  // Spin: full turn on the spot, arms thrown wide, then a landing bounce
  (p, u, amp) => {
    const sp = spin(u, 0.04, 0.6);
    const flare = sp.bump * 0.0;
    const phase = Math.sin(Math.PI * p);
    return {
      ...neutral(),
      ...legsTogether(p, amp),
      hairSwing: sp.bump,
      globalYaw: sp.yaw,
      shoulderYaw: -sp.bump * 0.2,
      // one hand slices the air overhead, the other stays wide for balance
      armL: limb(-(1.35 + flare + 0.2 * phase), 0.0, -(1.35 + flare + 0.2 * phase) - 0.2, 0),
      armR: armRight(0.75 + 0.2 * sp.bump + 0.1 * phase, 0.15 * phase),
    };
  },
  // Groove wave: both arms ripple through the air, shoulders roll, quarter turns
  (p, _u, amp) => {
    const s = Math.sin(Math.PI * p);
    const half = Math.sin(Math.PI * p * 0.5);
    return {
      ...neutral(),
      ...legsBounce(p, amp, 0.32),
      hipX: -half * 1.0 * amp,
      lean: -half * 0.1 * amp,
      shoulderYaw: half * 0.5 * amp,
      hipYaw: -half * 0.4 * amp,
      globalYaw: Math.sin(Math.PI * p * 0.25 + 1) * 0.7,
      headTilt: s * 0.16 * amp,
      armL: armLeft(0.55 + 0.45 * Math.sin(Math.PI * p + 0.5), 0.5 * Math.sin(Math.PI * p - 0.6)),
      armR: armRight(0.55 + 0.45 * Math.sin(Math.PI * p + 0.5 + Math.PI), 0.5 * Math.sin(Math.PI * p - 0.6 + Math.PI)),
    };
  },
];

// ---- She: fluid, hip-led moves, pirouettes ----------------------------------------------------
const FEMALE_MOVES: Move[] = [
  // Hip sway: slow figure-8 with one hand overhead and the other trailing low
  (p, _u, amp) => {
    const half = Math.sin(Math.PI * p * 0.5);
    const k = 0.5 + 0.5 * half;
    return {
      ...neutral(),
      ...legsBounce(p, amp * 0.7, 0.2),
      hairSwing: half * 0.7,
      hipX: half * 1.9 * amp,
      lean: -half * 0.16 * amp,
      shoulderYaw: -half * 0.5 * amp,
      hipYaw: half * 0.65 * amp,
      globalYaw: Math.sin(Math.PI * p * 0.25) * 0.5,
      headTilt: -half * 0.22,
      armL: armLeft(k, 0.55 * Math.sin(Math.PI * p * 0.5 - 0.8)),
      armR: armRight(1 - k, 0.55 * Math.sin(Math.PI * p * 0.5 + 2.3)),
    };
  },
  // Pump: alternate high reaches, opposite to his rhythm
  (p, _u, amp) => {
    const c = Math.cos(Math.PI * p);
    const k = 0.5 + 0.5 * c;
    return {
      ...neutral(),
      ...legsBounce(p, amp, 0.24),
      hairSwing: c * 0.5,
      hipX: Math.sin(Math.PI * p * 0.5) * 1.3 * amp,
      lean: Math.sin(Math.PI * p * 0.5) * 0.1 * amp,
      shoulderYaw: Math.sin(Math.PI * p * 0.5) * 0.4 * amp,
      hipYaw: -Math.sin(Math.PI * p * 0.5) * 0.5 * amp,
      globalYaw: Math.sin(Math.PI * p * 0.25 + 1.5) * 0.45,
      headTilt: c * 0.14,
      armL: armLeft(1 - k, 0.25 * c),
      armR: armRight(k, -0.25 * c),
    };
  },
  // Pirouette: both hands overhead, a graceful full turn with flying hair
  (p, u, amp) => {
    const sp = spin(u, 0.05, 0.64);
    const lift = sp.bump;
    return {
      ...neutral(),
      ...legsTogether(p, amp * 1.15),
      hop: legsTogether(p, amp * 1.15).hop + lift * 0.9,
      hairSwing: 0.4 + sp.bump * 1.6,
      globalYaw: sp.yaw,
      lean: 0,
      armL: armLeft(0.95, 0.1, 0),
      armR: armRight(0.95, -0.1, 0),
      legR: limb(0.1, -0.15 * lift, 0.25 * lift, -1.1 * lift),
    };
  },
  // Flow: one arm sweeps up while the other falls, hips circle, a quarter turn back and forth
  (p, _u, amp) => {
    const m = Math.sin(Math.PI * p * 0.5);
    const b = Math.abs(Math.sin(Math.PI * p));
    return {
      ...neutral(),
      ...legsBounce(p, amp * 0.8, 0.28),
      hairSwing: m * 0.9,
      hipX: -m * 1.5 * amp,
      lean: m * 0.14 * amp,
      shoulderYaw: m * 0.45 * amp,
      hipYaw: -m * 0.6 * amp,
      globalYaw: Math.PI * 0.55 * (0.5 - 0.5 * Math.cos(Math.PI * p * 0.5)),
      headTilt: -m * 0.2,
      armL: armLeft(smooth(0.5 - m * 0.8), 0.4 * b),
      armR: armRight(smooth(0.5 + m * 0.8), 0.4 * b),
    };
  },
];

const MOVE_BEATS = 4;
const BLEND_BEATS = 0.6;

function choreography(moves: Move[], order: number[], p: number, amp: number): Pose {
  const total = order.length;
  const idx = Math.floor(p / MOVE_BEATS);
  const local = p - idx * MOVE_BEATS;
  const cur = moves[order[((idx % total) + total) % total]];
  const nxt = moves[order[(((idx + 1) % total) + total) % total]];
  const base = cur(p, local / MOVE_BEATS, amp);
  const blendStart = MOVE_BEATS - BLEND_BEATS;
  if (local <= blendStart) return base;
  const t = smooth((local - blendStart) / BLEND_BEATS);
  return blendPose(base, nxt(p, 0, amp), t);
}

const poseA = (p: number, amp: number): Pose => choreography(MALE_MOVES, [0, 1, 2, 3], p, amp);
const poseB = (p: number, amp: number): Pose => choreography(FEMALE_MOVES, [0, 3, 1, 2], p, amp);

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

function buildFigure(pose: Pose, pal: DancerPalette, st: BodyStyle): { items: DrawItem[]; hop: number } {
  const hipR = (sx: number): V3 => rotY({ x: sx * st.hipW, y: 0, z: 0 }, pose.hipYaw);
  const leanX = Math.sin(pose.lean);
  const leanY = Math.cos(pose.lean);
  const neckBase: V3 = { x: leanX * 8.2, y: -leanY * 8.2, z: 0 };
  const shoulderOff = (sx: number): V3 => rotY({ x: sx * st.shoulderW, y: 0, z: 0 }, pose.shoulderYaw);
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

  const headYawLocal = pose.shoulderYaw * 0.6;
  const hairBackLocal = (() => {
    const o = rotY({ x: 0, y: -0.5, z: -1.0 }, headYawLocal);
    return { x: head.x + o.x, y: head.y + o.y, z: head.z + o.z };
  })();
  const ponyRoot = (() => {
    const o = rotY({ x: 2.0, y: -0.2, z: -1.8 }, headYawLocal);
    return { x: head.x + o.x, y: head.y + o.y, z: head.z + o.z };
  })();
  const sw = pose.hairSwing;
  const ponyMid: V3 = { x: ponyRoot.x + 0.6 + sw * 2.6, y: ponyRoot.y + 2.7, z: ponyRoot.z - 0.9 };
  const ponyEnd: V3 = { x: ponyMid.x + sw * 3.2, y: ponyMid.y + 2.5, z: ponyMid.z - 0.4 };

  const world = (p: V3): V3 => {
    const r = rotY(p, pose.globalYaw);
    return { x: r.x + pose.hipX, y: r.y, z: r.z };
  };
  const W = {
    sL: world(sL), sR: world(sR), hL: world(hL), hR: world(hR),
    eL: world(elbowL), eR: world(elbowR), wL: world(wristL), wR: world(wristR),
    kL: world(kneeL), kR: world(kneeR), aL: world(ankleL), aR: world(ankleR),
    tL: world(toeL), tR: world(toeR), nb: world(neckBase), head: world(head),
    skirtL: world({ x: hL.x - 3.0 - Math.abs(pose.hairSwing) * 1.8, y: hL.y + 6.0, z: hL.z }), skirtR: world({ x: hR.x + 3.0 + Math.abs(pose.hairSwing) * 1.8, y: hR.y + 6.0, z: hR.z }),
    hairBack: world(hairBackLocal), ponyRoot: world(ponyRoot), ponyMid: world(ponyMid), ponyEnd: world(ponyEnd),
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
        const rr = r * p.k * THICK;
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
        const ra = r1 * a.k * THICK;
        const rb = r2 * b.k * THICK;
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
    skirtL: proj(W.skirtL), skirtR: proj(W.skirtR),
    hairBack: proj(W.hairBack), ponyRoot: proj(W.ponyRoot), ponyMid: proj(W.ponyMid), ponyEnd: proj(W.ponyEnd),
  };

  // Legs
  capsule(P.hL, P.kL, st.thigh, st.thigh * 0.78, pal.legs);
  capsule(P.kL, P.aL, st.thigh * 0.78, 1.0, pal.legs);
  capsule(P.aL, P.tL, 1.05, 0.85, pal.accent);
  capsule(P.hR, P.kR, st.thigh, st.thigh * 0.78, pal.legs);
  capsule(P.kR, P.aR, st.thigh * 0.78, 1.0, pal.legs);
  capsule(P.aR, P.tR, 1.05, 0.85, pal.accent);
  // Torso
  capsule(P.hip, P.nb, st.torsoLow, st.torsoHigh, pal.body);
  if (st.ponytail) {
    // Flowing skirt: flares out on turns and catches light like cloth
    items.push({
      z: P.hip.z + 0.9,
      draw: (ctx) => {
        const df = depthShade(P.hip.z);
        const g = ctx.createLinearGradient(P.hL.x, P.hL.y - 2, P.skirtR.x, P.skirtR.y + 2);
        g.addColorStop(0, tone(pal.accent, 1.0 * df));
        g.addColorStop(0.5, tone(pal.arms, 1.0 * df));
        g.addColorStop(1, tone(pal.body, 0.7 * df));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(P.hL.x - 0.4, P.hL.y - 1.2);
        ctx.lineTo(P.hR.x + 0.4, P.hR.y - 1.2);
        ctx.quadraticCurveTo(P.skirtR.x + 0.8, P.skirtR.y - 2.5, P.skirtR.x, P.skirtR.y);
        ctx.quadraticCurveTo((P.skirtL.x + P.skirtR.x) / 2, P.skirtR.y + 1.6, P.skirtL.x, P.skirtL.y);
        ctx.quadraticCurveTo(P.skirtL.x - 0.8, P.skirtL.y - 2.5, P.hL.x - 0.4, P.hL.y - 1.2);
        ctx.closePath();
        ctx.fill();
      },
    });
    // Fitted hips / waist: a soft pelvis volume for the feminine silhouette
    sphere(P.hL, 2.15, pal.body);
    sphere(P.hR, 2.15, pal.body);
  }
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
  sphere(P.head, st.headR, pal.head);
  if (st.ponytail) {
    sphere(P.hairBack, st.headR + 0.35, pal.hair);
    capsule(P.ponyRoot, P.ponyMid, 1.45, 1.15, pal.hair);
    capsule(P.ponyMid, P.ponyEnd, 1.15, 0.55, pal.hair);
  }
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
  const { items } = buildFigure(pose, pal, d.side === 'left' ? MALE_STYLE : FEMALE_STYLE);

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
      cell = mobile ? 3.5 : 5.0;
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
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
      if (nowMs - lastDraw < 42) return;
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
