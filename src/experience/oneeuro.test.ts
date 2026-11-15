import { describe, expect, it } from 'vitest';
import { LandmarkFilter, OneEuro } from './oneeuro';

describe('OneEuro', () => {
  it('passes the first sample through', () => {
    expect(new OneEuro(1, 0).filter(5, 0)).toBe(5);
  });

  it('smooths jitter around a still value', () => {
    const f = new OneEuro(1, 0);
    let t = 0;
    const out: number[] = [];
    for (let i = 0; i < 120; i++) {
      t += 1 / 30;
      out.push(f.filter(10 + (i % 2 ? 0.5 : -0.5), t));
    }
    const tail = out.slice(-20);
    const range = Math.max(...tail) - Math.min(...tail);
    expect(range).toBeLessThan(0.4); // input swings by 1.0
  });

  it('tracks fast motion with little lag when beta > 0', () => {
    const slow = new OneEuro(1, 0);
    const fast = new OneEuro(1, 40);
    let t = 0, a = 0, b = 0;
    for (let i = 0; i < 15; i++) {
      t += 1 / 30;
      a = slow.filter(i * 0.1, t);
      b = fast.filter(i * 0.1, t);
    }
    const target = 14 * 0.1;
    expect(Math.abs(target - b)).toBeLessThan(Math.abs(target - a));
  });

  it('converges to a constant step', () => {
    const f = new OneEuro(1, 0);
    f.filter(0, 0);
    let v = 0;
    for (let i = 1; i <= 90; i++) v = f.filter(1, i / 30);
    expect(v).toBeGreaterThan(0.99);
  });
});

describe('LandmarkFilter', () => {
  it('filters all 21 points and resets', () => {
    const lf = new LandmarkFilter(640);
    const lm = Array.from({ length: 21 }, (_, i) => ({ x: i, y: i * 2, z: 0 }));
    expect(lf.filter(lm, 0)).toEqual(lm);
    const moved = lm.map((p) => ({ ...p, x: p.x + 100 }));
    const out = lf.filter(moved, 0.033);
    expect(out[3]!.x).toBeGreaterThan(3);
    expect(out[3]!.x).toBeLessThan(103);
    lf.reset();
    expect(lf.filter(moved, 1)).toEqual(moved);
  });
});
