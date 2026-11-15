// Mapping between video pixels, screen pixels and the three.js world (z = 0 plane).
// Pure maths so it can be unit-tested. The video is shown with object-fit: cover and,
// for the front camera, mirrored; everything here keeps that consistent.

export const CAMERA_FOV = 45;
export const CAMERA_DIST = 10;

export interface ViewMap {
  /** Viewport size in CSS pixels. */
  W: number;
  H: number;
  /** Video frame size in pixels. */
  vw: number;
  vh: number;
  mirrored: boolean;
}

export function coverScale(m: ViewMap): number {
  return Math.max(m.W / m.vw, m.H / m.vh);
}

/** Half the visible world height at the z = 0 plane. */
export function halfHeight(): number {
  return Math.tan((CAMERA_FOV * Math.PI) / 360) * CAMERA_DIST;
}

/** World units per CSS pixel on the z = 0 plane. */
export function worldPerPx(m: ViewMap): number {
  return (2 * halfHeight()) / m.H;
}

/** Video pixel -> screen CSS pixel (after cover + mirror). */
export function videoToScreen(m: ViewMap, x: number, y: number): [number, number] {
  const s = coverScale(m);
  const ox = (m.W - m.vw * s) / 2;
  const oy = (m.H - m.vh * s) / 2;
  const sx = x * s + ox;
  return [m.mirrored ? m.W - sx : sx, y * s + oy];
}

/** Video pixel -> world position on z = 0. */
export function videoToWorld(m: ViewMap, x: number, y: number): [number, number] {
  const [sx, sy] = videoToScreen(m, x, y);
  const k = worldPerPx(m);
  return [(sx - m.W / 2) * k, -(sy - m.H / 2) * k];
}

/** A length in video pixels -> world units. */
export function lengthToWorld(m: ViewMap, len: number): number {
  return len * coverScale(m) * worldPerPx(m);
}

/** A direction in video space -> world direction (mirror flips x, y axis flips). */
export function dirToWorld(m: ViewMap, dx: number, dy: number): [number, number] {
  return [m.mirrored ? -dx : dx, -dy];
}
