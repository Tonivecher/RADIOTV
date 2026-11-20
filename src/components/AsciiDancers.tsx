import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { getReactiveAudioEnergy } from '../audio/reactiveTelemetry';
import { resolveChannelAsciiProfile } from '../constants/ascii';

interface AsciiDancersProps {
  channelId: string;
}

type BodyPart = ' ' | 'h' | 'a' | 'b' | 'l' | 's';

interface DancerFrame {
  chars: readonly string[];
  parts: readonly string[];
}

interface DancerPalette {
  head: string;
  arms: string;
  body: string;
  legs: string;
  spark: string;
  glow: string;
}

const PALETTES: Record<string, { left: DancerPalette; right: DancerPalette }> = {
  'ch-main': {
    left: {
      head: '#fde0b6',
      arms: '#f5b878',
      body: '#e88b48',
      legs: '#c2d2b5',
      spark: '#fff1d0',
      glow: 'rgba(234, 185, 138, 0.42)',
    },
    right: {
      head: '#e2f2d8',
      arms: '#f4c592',
      body: '#88c498',
      legs: '#b6cce0',
      spark: '#f8e6b8',
      glow: 'rgba(194, 210, 181, 0.42)',
    },
  },
  'ch-deep': {
    left: {
      head: '#ffd0ca',
      arms: '#f4c49c',
      body: '#e86f68',
      legs: '#d898a0',
      spark: '#ffebe0',
      glow: 'rgba(232, 137, 128, 0.44)',
    },
    right: {
      head: '#fce4c8',
      arms: '#ffada4',
      body: '#e8a272',
      legs: '#d89282',
      spark: '#fff0d8',
      glow: 'rgba(236, 192, 158, 0.44)',
    },
  },
  'ch-afterglow': {
    left: {
      head: '#e6dcff',
      arms: '#f2cca6',
      body: '#a48bf6',
      legs: '#8cb0f0',
      spark: '#f6ecff',
      glow: 'rgba(189, 168, 242, 0.46)',
    },
    right: {
      head: '#fce4c4',
      arms: '#cab8ff',
      body: '#e6a876',
      legs: '#a896dc',
      spark: '#fff2d8',
      glow: 'rgba(232, 194, 158, 0.44)',
    },
  },
};

// 8 rhythmic 5x9 ASCII frames with per-character part masks:
// h = head/headphones, a = arms, b = torso, l = legs, s = beat spark
const DANCER_FRAMES: readonly DancerFrame[] = [
  {
    chars: [
      ' \\ (o) / ',
      '  \\_#_/  ',
      '   |#|   ',
      '  /   \\  ',
      ' `     ` ',
    ],
    parts: [
      ' a hhh a ',
      '  aabaa  ',
      '   bbb   ',
      '  l   l  ',
      ' l     l ',
    ],
  },
  {
    chars: [
      '         ',
      ' ~(O)~   ',
      '  /#\\    ',
      ' / | \\   ',
      '  / \\    ',
    ],
    parts: [
      '         ',
      ' ahhha   ',
      '  aba    ',
      ' a b a   ',
      '  l l    ',
    ],
  },
  {
    chars: [
      '   (o) / ',
      '  /|#_/  ',
      ' / |#|   ',
      '  /  \\   ',
      ' `    \'  ',
    ],
    parts: [
      '   hhh a ',
      '  abbaa  ',
      ' a bbb   ',
      '  l  l   ',
      ' l    l  ',
    ],
  },
  {
    chars: [
      ' \\ (O)   ',
      '  \\_#|\\  ',
      '   |#| \\ ',
      '  /  \\   ',
      ' \'    `  ',
    ],
    parts: [
      ' a hhh   ',
      '  aabba  ',
      '   bbb a ',
      '  l  l   ',
      ' l    l  ',
    ],
  },
  {
    chars: [
      '* (o) *  ',
      ' \\|#|/   ',
      '  |#|    ',
      ' /   \\   ',
      '/     \\  ',
    ],
    parts: [
      's hhh s  ',
      ' abbba   ',
      '  bbb    ',
      ' l   l   ',
      'l     l  ',
    ],
  },
  {
    chars: [
      '         ',
      '   (O)   ',
      '  <|#|>  ',
      '   / \\   ',
      '  \'   `  ',
    ],
    parts: [
      '         ',
      '   hhh   ',
      '  abbba  ',
      '   l l   ',
      '  l   l  ',
    ],
  },
  {
    chars: [
      ' / (o)   ',
      '/ /#|\\   ',
      '  |#| ~  ',
      ' /   \\   ',
      '`     `  ',
    ],
    parts: [
      ' a hhh   ',
      'a abba   ',
      '  bbb a  ',
      ' l   l   ',
      'l     l  ',
    ],
  },
  {
    chars: [
      '   (o) \\ ',
      '  /|#\\ \\ ',
      ' ~ |#|   ',
      '  /   \\  ',
      ' `     ` ',
    ],
    parts: [
      '   hhh a ',
      '  abba a ',
      ' a bbb   ',
      '  l   l  ',
      ' l     l ',
    ],
  },
];

function getPartColor(part: BodyPart, palette: DancerPalette): string | undefined {
  switch (part) {
    case 'h':
      return palette.head;
    case 'a':
      return palette.arms;
    case 'b':
      return palette.body;
    case 'l':
      return palette.legs;
    case 's':
      return palette.spark;
    default:
      return undefined;
  }
}

interface DancerSpriteProps {
  side: 'left' | 'right';
  frameIndex: number;
  palette: DancerPalette;
  dancerRef: React.RefObject<HTMLDivElement | null>;
}

const DancerSprite: React.FC<DancerSpriteProps> = ({ side, frameIndex, palette, dancerRef }) => {
  const frame = DANCER_FRAMES[frameIndex % DANCER_FRAMES.length];

  return (
    <div
      ref={dancerRef}
      className={`ascii-dancer ascii-dancer--${side}`}
      data-ascii-dancer={side}
      aria-hidden="true"
      style={{ '--dancer-glow': palette.glow } as React.CSSProperties}
    >
      <pre className="ascii-dancer__art">
        {frame.chars.map((line, rowIdx) => {
          const partRow = frame.parts[rowIdx] || '';
          return (
            <span key={rowIdx} className="ascii-dancer__row">
              {Array.from(line, (ch, colIdx) => {
                if (ch === ' ') {
                  return ' ';
                }
                const part = (partRow[colIdx] || 'b') as BodyPart;
                const color = getPartColor(part, palette);
                return (
                  <span key={colIdx} style={color ? { color } : undefined}>
                    {ch}
                  </span>
                );
              })}
            </span>
          );
        })}
      </pre>
    </div>
  );
};

export const AsciiDancers: React.FC<AsciiDancersProps> = ({ channelId }) => {
  const reducedMotion = Boolean(useReducedMotion());
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const [frames, setFrames] = useState<[number, number]>([0, 3]);

  const pair = PALETTES[channelId] || PALETTES['ch-main'];

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    const profile = resolveChannelAsciiProfile(channelId);
    const baseBeatHz = profile.grooveBpm / 60;
    let rafId = 0;
    let phase = 0;
    let lastMs = performance.now();
    let lastFramePair: [number, number] = [0, 3];

    const tick = (nowMs: number) => {
      if (document.hidden) {
        lastMs = nowMs;
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min(0.1, Math.max(0.001, (nowMs - lastMs) * 0.001));
      lastMs = nowMs;
      const nowSec = nowMs * 0.001;
      const energy = getReactiveAudioEnergy(nowSec);

      // Always dancing in channel groove; live music boosts bounce & energy.
      const grooveSpeed = energy.isPlaying
        ? baseBeatHz * (1.85 + energy.level * 0.55)
        : baseBeatHz * 1.55;
      phase += dt * grooveSpeed;

      const leftIdx = Math.floor(phase) % DANCER_FRAMES.length;
      const rightIdx = (Math.floor(phase + 2.5) + 1) % DANCER_FRAMES.length;

      if (leftIdx !== lastFramePair[0] || rightIdx !== lastFramePair[1]) {
        lastFramePair = [leftIdx, rightIdx];
        setFrames([leftIdx, rightIdx]);
      }

      const amp = energy.isPlaying ? 0.62 + energy.level * 0.58 : 0.48;
      const kickL = Math.pow(0.5 + 0.5 * Math.sin(phase * Math.PI), 2.2);
      const kickR = Math.pow(0.5 + 0.5 * Math.sin((phase + 0.5) * Math.PI), 2.2);
      const swayL = Math.sin(phase * Math.PI * 0.5) * 2.2 * amp;
      const swayR = Math.sin((phase + 0.65) * Math.PI * 0.5) * 2.2 * amp;
      const tiltL = Math.sin(phase * Math.PI * 0.5) * 4.5 * amp;
      const tiltR = -Math.sin((phase + 0.5) * Math.PI * 0.5) * 4.5 * amp;

      if (leftRef.current) {
        leftRef.current.style.transform = `translate3d(${swayL.toFixed(2)}px, ${(-kickL * 5.2 * amp).toFixed(2)}px, 0) rotate(${tiltL.toFixed(2)}deg)`;
      }
      if (rightRef.current) {
        rightRef.current.style.transform = `translate3d(${swayR.toFixed(2)}px, ${(-kickR * 5.2 * amp).toFixed(2)}px, 0) rotate(${tiltR.toFixed(2)}deg)`;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [channelId, reducedMotion]);

  return (
    <>
      <DancerSprite side="left" frameIndex={frames[0]} palette={pair.left} dancerRef={leftRef} />
      <DancerSprite side="right" frameIndex={frames[1]} palette={pair.right} dancerRef={rightRef} />
    </>
  );
};
