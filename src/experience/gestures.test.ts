import { describe, expect, it } from 'vitest';
import {
  Brain,
  GestureClassifier,
  PushDetector,
  assignSlots,
  facingOk,
  handFeatures,
  type BrainEvent,
  type RawHand,
} from './gestures';
import { synthHand } from './synth';

const hand = (o: Partial<Parameters<typeof synthHand>[0]> = {}) =>
  synthHand({ cx: 320, cy: 300, size: 120, ...o });

describe('features', () => {
  it('open palm: all fingers extended', () => {
    const f = handFeatures(hand({ open: 1 }));
    expect(f.openness).toBeGreaterThan(0.85);
    expect(f.ext.every((e) => e > 0.7)).toBe(true);
  });

  it('fist: fingers curled', () => {
    expect(handFeatures(hand({ open: 0 })).openness).toBeLessThan(0.2);
  });

  it('is scale invariant', () => {
    const a = handFeatures(hand({ size: 40 }));
    const b = handFeatures(hand({ size: 400, cx: 100, cy: 100 }));
    expect(a.openness).toBeCloseTo(b.openness, 5);
    expect(a.pinch).toBeCloseTo(b.pinch, 5);
  });

  it('is roll invariant', () => {
    const a = handFeatures(hand({ roll: 0 }));
    const b = handFeatures(hand({ roll: 1.2 }));
    expect(a.openness).toBeCloseTo(b.openness, 5);
  });

  it('pinch: thumb meets index, other fingers stay extended', () => {
    const f = handFeatures(hand({ open: 1, pinch: true }));
    expect(f.pinch).toBeLessThan(0.2);
    expect(f.others).toBeGreaterThan(0.8);
    expect(handFeatures(hand({ open: 1 })).pinch).toBeGreaterThan(0.5);
  });

  it('palm vs back of hand (needs the handedness label)', () => {
    expect(facingOk(handFeatures(hand()), 'Left')).toBe(true);
    expect(facingOk(handFeatures(hand({ back: true })), 'Left')).toBe(false);
    // the other chirality is reported as Right and flips the test back
    expect(facingOk(handFeatures(hand({ flip: true })), 'Right')).toBe(true);
    expect(facingOk(handFeatures(hand({ flip: true, back: true })), 'Right')).toBe(false);
    // no label: the gate is skipped
    expect(facingOk(handFeatures(hand({ back: true })))).toBe(true);
  });
});

describe('GestureClassifier', () => {
  const run = (c: GestureClassifier, lm: ReturnType<typeof hand>, t0: number, n = 6) => {
    let g = c.state;
    for (let i = 0; i < n; i++) g = c.update(handFeatures(lm), t0 + i / 30, true);
    return g;
  };

  it('classifies open, fist and pinch', () => {
    expect(run(new GestureClassifier(), hand({ open: 1 }), 0)).toBe('open');
    expect(run(new GestureClassifier(), hand({ open: 0 }), 0)).toBe('fist');
    expect(run(new GestureClassifier(), hand({ open: 1, pinch: true }), 0)).toBe('pinch');
  });

  it('needs a short dwell before switching', () => {
    const c = new GestureClassifier();
    run(c, hand({ open: 1 }), 0);
    c.update(handFeatures(hand({ open: 0 })), 1.0, true);
    expect(c.state).toBe('open'); // first fist frame is not enough
    c.update(handFeatures(hand({ open: 0 })), 1.1, true);
    expect(c.state).toBe('fist');
  });

  it('has hysteresis: openness between the thresholds keeps the current state', () => {
    const mid = hand({ open: 0.62 });
    const fm = handFeatures(mid);
    expect(fm.openness).toBeGreaterThan(0.45);
    expect(fm.openness).toBeLessThan(0.72);
    const wasOpen = new GestureClassifier();
    run(wasOpen, hand({ open: 1 }), 0);
    expect(run(wasOpen, mid, 1, 10)).toBe('open');
    const wasFist = new GestureClassifier();
    run(wasFist, hand({ open: 0 }), 0);
    expect(run(wasFist, mid, 1, 10)).toBe('none'); // above fistOff, below openOn
  });

  it('does not report open when the back of the hand faces the camera', () => {
    const c = new GestureClassifier();
    const f = handFeatures(hand({ back: true }));
    for (let i = 0; i < 10; i++) c.update(f, i / 30, facingOk(f, 'Left'));
    expect(c.state).toBe('none');
  });
});

describe('PushDetector', () => {
  it('fires when the palm grows quickly', () => {
    const p = new PushDetector();
    let fired = false;
    for (let i = 0; i < 40; i++) {
      const t = i / 30;
      const size = i < 20 ? 100 : 100 * Math.exp(0.14 * (i - 20)); // ~ +15%/frame -> big rate
      if (p.update(t, size, 300, 300)) fired = true;
    }
    expect(fired).toBe(true);
  });

  it('does not fire for slow drift in size or position', () => {
    const p = new PushDetector();
    for (let i = 0; i < 90; i++) {
      const t = i / 30;
      expect(p.update(t, 100 + i * 0.3, 300 + i * 1.2, 300)).toBe(false);
    }
  });

  it('fires on a fast flick', () => {
    const p = new PushDetector();
    let fired = false;
    for (let i = 0; i < 20; i++) {
      if (p.update(i / 30, 100, 100 + (i > 8 ? (i - 8) * 90 : 0), 300)) fired = true;
    }
    expect(fired).toBe(true);
  });

  it('respects the cooldown', () => {
    const p = new PushDetector();
    let n = 0;
    for (let i = 0; i < 20; i++) if (p.update(i / 30, 100 * Math.exp(0.2 * i), 300, 300)) n++;
    expect(n).toBe(1);
  });
});

describe('assignSlots', () => {
  it('keeps identity by proximity and fills free slots', () => {
    const prev = [{ x: 100, y: 100 }, { x: 500, y: 100 }];
    expect(assignSlots(prev, [80, 80], [{ x: 505, y: 100 }, { x: 95, y: 105 }])).toEqual([1, 0]);
    expect(assignSlots([null, null], [0, 0], [{ x: 1, y: 1 }])).toEqual([0]);
    expect(assignSlots([{ x: 100, y: 100 }, null], [80, 0], [{ x: 900, y: 900 }])).toEqual([1]);
  });
});

describe('Brain', () => {
  const FPS = 30;
  function drive(brain: Brain, from: number, secs: number, make: (t: number) => RawHand[]) {
    const events: BrainEvent[] = [];
    let last = brain.update(from, make(from));
    for (let i = 1; i <= secs * FPS; i++) {
      const t = from + i / FPS;
      last = brain.update(t, make(t));
      events.push(...last.events);
    }
    return { last, events, end: from + secs };
  }
  const open = (cx = 320, size = 120): RawHand[] => [{ lm: synthHand({ cx, cy: 300, size }) }];

  it('charges an open palm over about 0.8 s', () => {
    const b = new Brain();
    const half = drive(b, 0, 0.4, () => open());
    expect(half.last.slots[0]!.charge).toBeGreaterThan(0.2);
    expect(half.last.slots[0]!.charge).toBeLessThan(0.7);
    const full = drive(b, half.end, 0.8, () => open());
    expect(full.last.slots[0]!.charge).toBe(1);
    expect(full.events.some((e) => e.type === 'charged')).toBe(true);
  });

  it('a fist implodes a charged orb', () => {
    const b = new Brain();
    const a = drive(b, 0, 1.2, () => open());
    const f = drive(b, a.end, 0.5, () => [{ lm: synthHand({ cx: 320, cy: 300, size: 120, open: 0 }) }]);
    expect(f.events.some((e) => e.type === 'implode')).toBe(true);
    expect(f.last.slots[0]!.charge).toBe(0);
  });

  it('a push launches a charged orb, then it recharges after the cooldown', () => {
    const b = new Brain();
    const a = drive(b, 0, 1.2, () => open());
    const p = drive(b, a.end, 0.5, (t) => {
      const k = Math.max(0, t - a.end - 0.1);
      return open(320, 120 * Math.exp(3.2 * Math.min(k, 0.25)));
    });
    expect(p.events.filter((e) => e.type === 'launch')).toHaveLength(1);
    const r = drive(b, p.end, 1.6, () => open());
    expect(r.last.slots[0]!.charge).toBeGreaterThan(0.9);
  });

  it('does not launch an uncharged orb', () => {
    const b = new Brain();
    const p = drive(b, 0, 0.4, (t) => open(320, 120 * Math.exp(4 * Math.min(t, 0.3))));
    expect(p.events.some((e) => e.type === 'launch')).toBe(false);
  });

  it('emits a pinch event once per pinch', () => {
    const b = new Brain();
    const a = drive(b, 0, 1.0, () => open());
    const p = drive(b, a.end, 0.5, () => [{ lm: synthHand({ cx: 320, cy: 300, size: 120, pinch: true }) }]);
    expect(p.events.filter((e) => e.type === 'pinch')).toHaveLength(1);
    // holding the pinch keeps the orb charged
    expect(p.last.slots[0]!.charge).toBeGreaterThan(0.9);
  });

  const two = (gap: number, o1 = {}, o2 = {}): RawHand[] => [
    { lm: synthHand({ cx: 320 - gap / 2, cy: 300, size: 100, ...o1 }), handedness: 'Left' },
    { lm: synthHand({ cx: 320 + gap / 2, cy: 300, size: 100, flip: true, ...o2 }), handedness: 'Right' },
  ];

  it('two open hands close together merge; pulling apart splits', () => {
    const b = new Brain();
    const apart = drive(b, 0, 0.8, () => two(520));
    expect(apart.last.merged).toBe(false);
    expect(apart.last.slots.filter((s) => s.present)).toHaveLength(2);
    const close = drive(b, apart.end, 0.8, () => two(200));
    expect(close.last.merged).toBe(true);
    expect(close.events.filter((e) => e.type === 'merge')).toHaveLength(1);
    const pulled = drive(b, close.end, 0.5, () => two(520));
    expect(pulled.last.merged).toBe(false);
    expect(pulled.events.some((e) => e.type === 'split')).toBe(true);
  });

  it('a fist breaks the merge, and one hand never merges', () => {
    const b = new Brain();
    const m = drive(b, 0, 1.2, () => two(200));
    expect(m.last.merged).toBe(true);
    const f = drive(b, m.end, 0.4, () => two(200, {}, { open: 0 }));
    expect(f.last.merged).toBe(false);
    const solo = new Brain();
    expect(drive(solo, 0, 1, () => open()).last.merged).toBe(false);
  });

  it('keeps slot identity when the hands swap order in the array', () => {
    const b = new Brain();
    drive(b, 0, 0.5, () => two(400));
    const r = drive(b, 0.5, 0.3, () => two(400).reverse());
    const [s0, s1] = r.last.slots;
    expect(s0!.center.x).toBeLessThan(s1!.center.x);
  });

  it('releases a hand after the dropout grace and fades its orb', () => {
    const b = new Brain();
    const a = drive(b, 0, 1.2, () => open());
    const held = drive(b, a.end, 0.15, () => []);
    expect(held.last.slots[0]!.present).toBe(true);
    const gone = drive(b, held.end, 0.6, () => []);
    expect(gone.last.slots[0]!.present).toBe(false);
    expect(gone.last.slots[0]!.charge).toBe(0);
  });
});
