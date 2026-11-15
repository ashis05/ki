// Scripted synthetic hands for tests and screenshots (`?fake=open|fist|pinch|two|push`).
// Only reachable from non-production builds (see index.ts). Contains no real data.

import type { RawHand } from './gestures';
import { synthHand } from './synth';

export const FAKE_MODES = ['open', 'fist', 'pinch', 'two', 'push'] as const;
export type FakeMode = (typeof FAKE_MODES)[number];

const smooth = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

export function fakeHands(mode: FakeMode, t: number, vw: number, vh: number): RawHand[] {
  const u = Math.min(vw, vh);
  const base = 0.21 * u;
  const sway = Math.sin(t * 1.3) * 0.012 * u;
  const cy = vh * 0.6 + Math.cos(t * 1.1) * 0.01 * u;
  const one = (o: Parameters<typeof synthHand>[0]): RawHand[] => [{ lm: synthHand(o), handedness: 'Left' }];

  switch (mode) {
    case 'open':
      return one({ cx: vw / 2 + sway, cy, size: base, open: 1 });
    case 'fist': {
      const p = t % 4.5;
      const open = p < 2.2 ? 1 : 1 - smooth(2.2, 2.35, p);
      return one({ cx: vw / 2 + sway, cy, size: base, open: p > 3.6 ? 1 : open });
    }
    case 'pinch': {
      const p = t % 4;
      const pinch = p > 1.5 && p < 2.8;
      return one({ cx: vw / 2 + sway, cy, size: base, open: 1, pinch });
    }
    case 'two': {
      const p = t % 9;
      // apart -> together (merge) -> apart (split)
      const gap = vw * (0.78 - 0.4 * smooth(1.0, 1.8, p) + 0.4 * smooth(6.0, 6.8, p));
      const s = base * 0.85;
      return [
        { lm: synthHand({ cx: vw / 2 - gap / 2, cy: cy + sway, size: s, open: 1 }), handedness: 'Left' },
        { lm: synthHand({ cx: vw / 2 + gap / 2, cy: cy - sway, size: s, open: 1, flip: true }), handedness: 'Right' },
      ];
    }
    case 'push': {
      const p = t % 5;
      const grow = 1 + 1.2 * smooth(2.6, 2.82, p) - 1.2 * smooth(3.4, 4.0, p);
      return one({ cx: vw / 2 + sway, cy, size: base * grow, open: 1 });
    }
  }
}
