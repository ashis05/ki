// Synthetic hand landmarks (21 points, video-pixel space). Used by the unit tests and by the
// non-production `?fake=` mode. Contains no real data. Not imported by the production bundle.

import type { P } from './oneeuro';

export interface SynthOpts {
  cx: number;
  cy: number;
  /** Wrist-to-middle-knuckle length in px. */
  size: number;
  /** 0 = fist .. 1 = open (applies to the four fingers). */
  open?: number;
  /** Thumb tip meets index tip. */
  pinch?: boolean;
  /** Mirror the hand (other chirality: pair with handedness 'Left'). */
  flip?: boolean;
  /** Back of the hand towards the camera. In 2D that looks like the other chirality. */
  back?: boolean;
  /** Roll in radians (0 = fingers up). */
  roll?: number;
}

const MCP_X = [-0.4, -0.13, 0.13, 0.38];
const MCP_Y = [-0.95, -1.0, -0.95, -0.85];
const SEG = [
  [0.38, 0.22, 0.19],
  [0.42, 0.25, 0.2],
  [0.4, 0.24, 0.2],
  [0.3, 0.17, 0.17],
];
// cumulative flexion (radians) after each joint at fully curled
const CURL = [(80 * Math.PI) / 180, (180 * Math.PI) / 180, (250 * Math.PI) / 180];

export function synthHand(o: SynthOpts): P[] {
  const open = o.open ?? 1;
  const curl = 1 - open;
  const sx = !!o.flip !== !!o.back ? -1 : 1;
  const zs = o.back ? -1 : 1;
  const pts: P[] = new Array(21).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  const set = (i: number, x: number, y: number, z: number) => {
    pts[i] = { x: x * sx, y, z: z * zs };
  };
  set(0, 0, 0, 0);

  const tipOf: { x: number; y: number; z: number }[] = [];
  for (let f = 0; f < 4; f++) {
    const x = MCP_X[f]!;
    let y = MCP_Y[f]!;
    let z = 0;
    const base = 5 + f * 4;
    set(base, x, y, z);
    for (let j = 0; j < 3; j++) {
      const phi = CURL[j]! * curl;
      const len = SEG[f]![j]!;
      y += -Math.cos(phi) * len;
      z += -Math.sin(phi) * len;
      set(base + 1 + j, x, y, z);
    }
    tipOf.push({ x, y, z });
  }

  // thumb: out to the side, tucked across the palm when curled
  const tOut = [
    [0.18 * (1 - 0.3 * curl), -0.2, 0],
    [0.4 * (1 - 0.6 * curl), -0.45 + 0.1 * curl, -0.05],
    [0.58 * (1 - 0.9 * curl), -0.62 + 0.25 * curl, -0.08],
    [0.74 * (1 - 1.1 * curl), -0.76 + 0.45 * curl, -0.1],
  ] as const;
  // thumb is on the index side: negative x in the base frame
  tOut.forEach(([x, y, z], i) => set(1 + i, -x - 0.2 * (i === 0 ? 0 : 1) * 0, y, z));

  if (o.pinch) {
    const t = tipOf[0]!;
    set(4, t.x + 0.02, t.y + 0.03, t.z - 0.02);
    set(3, t.x * 0.6 - 0.2 * 0.4, t.y * 0.55 - 0.05, t.z * 0.6);
  }

  // scale, roll, translate
  const c = Math.cos(o.roll ?? 0), s = Math.sin(o.roll ?? 0);
  return pts.map((p) => ({
    x: o.cx + (p.x * c - p.y * s) * o.size,
    y: o.cy + (p.x * s + p.y * c) * o.size,
    z: p.z * o.size,
  }));
}
