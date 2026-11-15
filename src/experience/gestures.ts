// Pure hand-gesture logic: feature extraction, classification with hysteresis, push detection
// and the per-hand "orb brain" (charge, implode, launch, merge). No DOM, no three.js, so it is
// unit-tested with synthetic landmarks. Landmarks are MediaPipe's 21 points in *video pixels*
// (x right, y down, z roughly in x units, negative towards the camera).

import { LandmarkFilter, type P } from './oneeuro';

export type { P };
export interface V2 {
  x: number;
  y: number;
}

export const LM = {
  WRIST: 0,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  MIDDLE_MCP: 9,
  PINKY_MCP: 17,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
} as const;

/** [mcp, pip, dip, tip] per finger. */
export const FINGERS: readonly (readonly [number, number, number, number])[] = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
export const TIPS = [4, 8, 12, 16, 20] as const;

export const CHARGE_TIME = 0.8; // seconds from spark to full orb
export const DROPOUT_GRACE = 0.25; // keep a hand this long after detection drops

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const d3 = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function angleAt(a: P, b: P, c: P): number {
  const ux = a.x - b.x, uy = a.y - b.y, uz = a.z - b.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const dot = ux * vx + uy * vy + uz * vz;
  const m = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
  return m < 1e-9 ? 0 : Math.acos(Math.min(1, Math.max(-1, dot / m)));
}

/** Wrist to middle-finger knuckle: the unit everything else is normalised by. */
export function palmSize(lm: readonly P[]): number {
  return d3(lm[LM.WRIST]!, lm[LM.MIDDLE_MCP]!);
}

export function palmCenter(lm: readonly P[]): V2 {
  let x = 0, y = 0;
  for (const i of [0, 5, 9, 13, 17]) {
    x += lm[i]!.x;
    y += lm[i]!.y;
  }
  return { x: x / 5, y: y / 5 };
}

/** 0 (fully curled) .. 1 (straight), from the PIP joint angle and tip distance, scale-free. */
export function fingerExtension(lm: readonly P[], f: readonly [number, number, number, number]): number {
  const [mcp, pip, dip, tip] = f;
  const wrist = lm[LM.WRIST]!;
  const straight = clamp01(((angleAt(lm[mcp]!, lm[pip]!, lm[dip]!) * 180) / Math.PI - 100) / 65);
  const reach = d3(wrist, lm[tip]!) / Math.max(d3(wrist, lm[mcp]!), 1e-6);
  const far = clamp01((reach - 1.15) / 0.55);
  return 0.5 * (straight + far);
}

export interface Features {
  /** Wrist-to-knuckle length in input units. */
  palm: number;
  ext: number[];
  /** Mean extension of the four fingers. */
  openness: number;
  /** Mean extension of middle, ring, pinky. */
  others: number;
  /** Thumb tip to index tip, in palms. */
  pinch: number;
  /** Signed palm-normal z over palm^2 (sign depends on handedness, see facingOk). */
  facing: number;
}

export function handFeatures(lm: readonly P[]): Features {
  const palm = Math.max(palmSize(lm), 1e-6);
  const ext = FINGERS.map((f) => fingerExtension(lm, f));
  const w = lm[LM.WRIST]!, a = lm[LM.INDEX_MCP]!, b = lm[LM.PINKY_MCP]!;
  const nz = (a.x - w.x) * (b.y - w.y) - (a.y - w.y) * (b.x - w.x);
  return {
    palm,
    ext,
    openness: (ext[0]! + ext[1]! + ext[2]! + ext[3]!) / 4,
    others: (ext[1]! + ext[2]! + ext[3]!) / 3,
    pinch: d3(lm[LM.THUMB_TIP]!, lm[LM.INDEX_TIP]!) / palm,
    facing: nz / (palm * palm),
  };
}

/**
 * The palm-normal sign flips with handedness. Calibrated on a real photo fed to MediaPipe
 * unmirrored: a left palm facing the camera is labelled "Left" and has facing > 0.
 */
export function chirality(handedness?: string): number {
  return handedness === 'Right' ? -1 : 1;
}

/** True unless the back of the hand clearly faces the camera. Without a label the test is skipped. */
export function facingOk(f: Features, handedness?: string): boolean {
  if (handedness !== 'Left' && handedness !== 'Right') return true;
  return f.facing * chirality(handedness) > -0.12;
}

export type Gesture = 'none' | 'open' | 'fist' | 'pinch';

export const THRESH = {
  pinchOn: 0.28,
  pinchOff: 0.42,
  pinchOthersOn: 0.6,
  pinchOthersOff: 0.4,
  fistOn: 0.28,
  fistOff: 0.45,
  openOn: 0.72,
  openOff: 0.52,
  dwell: 0.06,
};

/** Classifies a hand frame by frame, with hysteresis (different enter/exit thresholds) and a short dwell. */
export class GestureClassifier {
  state: Gesture = 'none';
  private cand: Gesture = 'none';
  private candSince = 0;

  reset(): void {
    this.state = 'none';
    this.cand = 'none';
  }

  raw(f: Features, facing: boolean): Gesture {
    const s = this.state;
    const T = THRESH;
    const pinchOn =
      s === 'pinch'
        ? f.pinch < T.pinchOff && f.others > T.pinchOthersOff
        : f.pinch < T.pinchOn && f.others > T.pinchOthersOn;
    if (pinchOn) return 'pinch';
    if (s === 'fist' ? f.openness < T.fistOff : f.openness < T.fistOn) return 'fist';
    if (facing && (s === 'open' ? f.openness > T.openOff : f.openness > T.openOn)) return 'open';
    return 'none';
  }

  update(f: Features, t: number, facing = true): Gesture {
    const r = this.raw(f, facing);
    if (r === this.state) {
      this.cand = r;
      return this.state;
    }
    if (r !== this.cand) {
      this.cand = r;
      this.candSince = t;
    }
    if (t - this.candSince >= THRESH.dwell) this.state = r;
    return this.state;
  }
}

/** Detects a push toward the camera (palm grows quickly) or a fast flick. */
export class PushDetector {
  private hist: { t: number; size: number; x: number; y: number }[] = [];
  private lastFire = -10;

  constructor(
    private growthRate = 1.5, // ln(size) per second
    private minRatio = 1.22,
    private flickSpeed = 6, // palm sizes per second
    private cooldown = 0.8,
  ) {}

  reset(): void {
    this.hist = [];
  }

  update(t: number, size: number, x: number, y: number): boolean {
    this.hist.push({ t, size, x, y });
    while (this.hist.length > 2 && t - this.hist[0]!.t > 0.35) this.hist.shift();
    if (t - this.lastFire < this.cooldown) return false;
    // Compare against the oldest sample that is at least ~100 ms old.
    let ref: (typeof this.hist)[number] | undefined;
    for (const h of this.hist) {
      if (t - h.t >= 0.1) ref = h;
      else break;
    }
    if (!ref) return false;
    const age = t - ref.t;
    const ratio = size / Math.max(ref.size, 1e-6);
    const grow = Math.log(ratio) / age;
    const speed = Math.hypot(x - ref.x, y - ref.y) / age / Math.max(ref.size, 1e-6);
    if ((grow > this.growthRate && ratio > this.minRatio) || speed > this.flickSpeed) {
      this.lastFire = t;
      this.hist = [{ t, size, x, y }];
      return true;
    }
    return false;
  }
}

/** Assigns detections to persistent slots by nearest centre. Returns slotIndex per detection (or -1). */
export function assignSlots(prev: (V2 | null)[], sizes: number[], centers: V2[]): number[] {
  const out = centers.map(() => -1);
  const pairs: { d: number; i: number; s: number }[] = [];
  centers.forEach((c, i) =>
    prev.forEach((p, s) => {
      if (!p) return;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < Math.max(sizes[s] ?? 0, 1) * 3) pairs.push({ d, i, s });
    }),
  );
  pairs.sort((a, b) => a.d - b.d);
  const usedS = new Set<number>();
  for (const p of pairs) {
    if (out[p.i] !== -1 || usedS.has(p.s)) continue;
    out[p.i] = p.s;
    usedS.add(p.s);
  }
  centers.forEach((_, i) => {
    if (out[i] !== -1) return;
    const free = prev.findIndex((p, s) => !usedS.has(s) && p === null);
    if (free !== -1) {
      out[i] = free;
      usedS.add(free);
    }
  });
  return out;
}

/* ------------------------------------------------------------------ brain */

export interface RawHand {
  lm: P[];
  handedness?: string;
}

export interface SlotView {
  id: number;
  present: boolean;
  gesture: Gesture;
  /** 0..1 orb charge. */
  charge: number;
  imploding: boolean;
  center: V2;
  /** Unit vector from wrist towards the fingers, in video space. */
  up: V2;
  /** Palm size in video pixels. */
  size: number;
  tips: V2[];
}

export type BrainEvent =
  | { type: 'pinch'; slot: number }
  | { type: 'launch'; slot: number; merged: boolean }
  | { type: 'implode'; slot: number }
  | { type: 'charged'; slot: number }
  | { type: 'merge' }
  | { type: 'split' };

export interface BrainFrame {
  slots: SlotView[];
  merged: boolean;
  events: BrainEvent[];
}

export const MERGE_ENTER = 2.6; // distance between palms, in palm sizes
export const MERGE_EXIT = 4.0;
const MERGE_HOLD = 0.25;
const LAUNCH_CHARGE = 0.85;
const LAUNCH_COOLDOWN = 0.6;
const PINCH_COOLDOWN = 0.7;

interface Slot {
  present: boolean;
  lastSeen: number;
  filter: LandmarkFilter;
  cls: GestureClassifier;
  push: PushDetector;
  lm: P[] | null;
  view: SlotView;
  charge: number;
  imploding: boolean;
  coolUntil: number;
  lastPinch: number;
  wasCharged: boolean;
}

export class Brain {
  private slots: Slot[];
  private lastT: number | null = null;
  private mergedState = false;
  private mergeSince: number | null = null;

  constructor(frameWidth = 640, count = 2) {
    this.slots = Array.from({ length: count }, (_, id) => ({
      present: false,
      lastSeen: -10,
      filter: new LandmarkFilter(frameWidth),
      cls: new GestureClassifier(),
      push: new PushDetector(),
      lm: null,
      charge: 0,
      imploding: false,
      coolUntil: 0,
      lastPinch: -10,
      wasCharged: false,
      view: {
        id,
        present: false,
        gesture: 'none',
        charge: 0,
        imploding: false,
        center: { x: 0, y: 0 },
        up: { x: 0, y: -1 },
        size: 1,
        tips: [],
      },
    }));
  }

  get merged(): boolean {
    return this.mergedState;
  }

  update(t: number, hands: readonly RawHand[]): BrainFrame {
    const dt = this.lastT === null ? 0.016 : Math.min(0.1, Math.max(1e-3, t - this.lastT));
    this.lastT = t;
    const events: BrainEvent[] = [];

    // --- assign detections to slots
    const centers = hands.map((h) => palmCenter(h.lm));
    const prev = this.slots.map((s) => (s.present && s.lm ? palmCenter(s.lm) : null));
    const sizes = this.slots.map((s) => (s.lm ? palmSize(s.lm) : 0));
    const assign = assignSlots(prev, sizes, centers);
    const seen = new Set<number>();
    hands.forEach((h, i) => {
      const si = assign[i];
      if (si === undefined || si < 0 || seen.has(si)) return;
      seen.add(si);
      this.observe(this.slots[si]!, t, dt, h, events);
    });

    // --- slots without a detection: hold briefly, then release
    this.slots.forEach((s, si) => {
      if (seen.has(si)) return;
      if (s.present && t - s.lastSeen > DROPOUT_GRACE) {
        s.present = false;
        s.filter.reset();
        s.cls.reset();
        s.push.reset();
        s.lm = null;
        s.imploding = false;
      }
      if (!s.present) {
        s.charge = Math.max(0, s.charge - dt * 4);
      } else {
        this.advanceCharge(s, si, t, dt, events);
      }
    });

    this.updateMerge(t, events);

    const slots = this.slots.map((s) => {
      s.view.present = s.present;
      s.view.gesture = s.cls.state;
      s.view.charge = s.charge;
      s.view.imploding = s.imploding;
      return s.view;
    });
    return { slots, merged: this.mergedState, events };
  }

  private observe(s: Slot, t: number, dt: number, h: RawHand, events: BrainEvent[]): void {
    const si = this.slots.indexOf(s);
    const wasPresent = s.present;
    s.present = true;
    s.lastSeen = t;
    const lm = s.filter.filter(h.lm, t);
    s.lm = lm;
    const f = handFeatures(lm);
    const prevGesture = s.cls.state;
    const g = s.cls.update(f, t, facingOk(f, h.handedness));
    const center = palmCenter(lm);
    const w = lm[LM.WRIST]!, m = lm[LM.MIDDLE_MCP]!;
    const len = Math.max(Math.hypot(m.x - w.x, m.y - w.y), 1e-6);
    s.view.center = center;
    s.view.up = { x: (m.x - w.x) / len, y: (m.y - w.y) / len };
    s.view.size = f.palm;
    s.view.tips = TIPS.map((i) => ({ x: lm[i]!.x, y: lm[i]!.y }));
    if (!wasPresent) s.push.reset();

    if (g === 'pinch' && prevGesture !== 'pinch' && t - s.lastPinch > PINCH_COOLDOWN) {
      s.lastPinch = t;
      events.push({ type: 'pinch', slot: si });
    }

    if (g === 'open' && s.charge >= LAUNCH_CHARGE && t >= s.coolUntil) {
      if (s.push.update(t, f.palm, center.x, center.y)) {
        const merged = this.mergedState;
        events.push({ type: 'launch', slot: si, merged });
        for (const o of merged ? this.slots : [s]) {
          o.charge = 0;
          o.coolUntil = t + LAUNCH_COOLDOWN;
          o.wasCharged = false;
          o.imploding = false;
        }
        return;
      }
    } else {
      // keep the history warm so growth is measured from the moment the orb is ready
      s.push.update(t, f.palm, center.x, center.y);
    }
    this.advanceCharge(s, si, t, dt, events);
  }

  private advanceCharge(s: Slot, si: number, t: number, dt: number, events: BrainEvent[]): void {
    const g = s.cls.state;
    if (g === 'fist') {
      if (!s.imploding && s.charge > 0.15) {
        s.imploding = true;
        events.push({ type: 'implode', slot: si });
      }
    } else if (g === 'open') {
      s.imploding = false;
    }
    if (s.imploding) {
      s.charge = Math.max(0, s.charge - dt * 6);
      if (s.charge === 0) s.imploding = false;
      s.wasCharged = false;
      return;
    }
    if (g === 'open' && t >= s.coolUntil) {
      s.charge = Math.min(1, s.charge + dt / CHARGE_TIME);
      if (s.charge >= 1 && !s.wasCharged) {
        s.wasCharged = true;
        events.push({ type: 'charged', slot: si });
      }
    } else if (g === 'none') {
      s.charge = Math.max(0, s.charge - dt * 0.6);
    } else if (g === 'fist') {
      s.charge = Math.max(0, s.charge - dt * 6);
    }
    // pinch: hold charge as is
  }

  private updateMerge(t: number, events: BrainEvent[]): void {
    const [a, b] = this.slots;
    if (!a || !b) return;
    const both = a.present && b.present;
    if (!both) {
      this.setMerged(false, events);
      this.mergeSince = null;
      return;
    }
    const dx = a.view.center.x - b.view.center.x;
    const dy = a.view.center.y - b.view.center.y;
    const avg = Math.max((a.view.size + b.view.size) / 2, 1e-6);
    const ratio = Math.hypot(dx, dy) / avg;
    const ok = (g: Gesture) => g === 'open' || g === 'pinch';
    if (this.mergedState) {
      if (ratio > MERGE_EXIT || !ok(a.cls.state) || !ok(b.cls.state)) this.setMerged(false, events);
      return;
    }
    if (a.cls.state === 'open' && b.cls.state === 'open' && ratio < MERGE_ENTER) {
      this.mergeSince ??= t;
      if (t - this.mergeSince >= MERGE_HOLD) this.setMerged(true, events);
    } else {
      this.mergeSince = null;
    }
  }

  private setMerged(v: boolean, events: BrainEvent[]): void {
    if (v === this.mergedState) return;
    this.mergedState = v;
    if (!v) this.mergeSince = null;
    events.push({ type: v ? 'merge' : 'split' });
  }
}
