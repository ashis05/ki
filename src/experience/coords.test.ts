import { describe, expect, it } from 'vitest';
import { lengthToWorld, videoToScreen, videoToWorld, type ViewMap } from './coords';

const base: ViewMap = { W: 400, H: 800, vw: 640, vh: 480, mirrored: true };

describe('coords', () => {
  it('maps the video centre to the screen/world centre', () => {
    const [sx, sy] = videoToScreen(base, 320, 240);
    expect(sx).toBeCloseTo(200);
    expect(sy).toBeCloseTo(400);
    const [wx, wy] = videoToWorld(base, 320, 240);
    expect(wx).toBeCloseTo(0);
    expect(wy).toBeCloseTo(0);
  });

  it('mirrors x for the front camera', () => {
    const m = videoToScreen(base, 100, 240)[0];
    const u = videoToScreen({ ...base, mirrored: false }, 100, 240)[0];
    expect(m + u).toBeCloseTo(base.W);
  });

  it('covers the viewport (cropping the video sides on a portrait screen)', () => {
    // scale = 800/480; video is 1066px wide on a 400px screen, so x=0 is off-screen
    expect(videoToScreen({ ...base, mirrored: false }, 0, 0)[0]).toBeLessThan(0);
  });

  it('world y is up, screen y is down', () => {
    expect(videoToWorld(base, 320, 0)[1]).toBeGreaterThan(0);
  });

  it('converts lengths consistently', () => {
    const a = videoToWorld(base, 320, 240);
    const b = videoToWorld(base, 320, 340);
    expect(Math.abs(b[1] - a[1])).toBeCloseTo(lengthToWorld(base, 100));
  });
});
