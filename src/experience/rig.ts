// Drives the orbs from brain output: spring physics (lag + overshoot), merge/split,
// launch projectiles and burst triggers. No input handling or rendering setup here.

import { Vector3 } from 'three';
import type { BrainEvent, BrainFrame, SlotView } from './gestures';
import { lengthToWorld, videoToWorld, type ViewMap } from './coords';
import { Orb, PaletteState, createShared, disposeShared, type OrbShared } from './orb';
import type { Fx } from './fx';
import type { SceneKit } from './scene';

interface Spring {
  step(x: number, v: number, target: number, dt: number, omega: number, zeta: number): [number, number];
}
const spring: Spring = {
  // semi-implicit damped spring, stable for the dt range we see
  step(x, v, target, dt, omega, zeta) {
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -2 * zeta * omega * v - omega * omega * (x - target);
      v += a * h;
      x += v * h;
    }
    return [x, v];
  },
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

interface Projectile {
  orb: Orb;
  age: number;
  dur: number;
  from: Vector3;
  power: number;
}

export interface RigCallbacks {
  onBurst(power: number): void;
}

export class OrbRig {
  private shared: OrbShared;
  private pool: Orb[] = [];
  private slotOrb: (Orb | null)[] = [null, null];
  private projectiles: Projectile[] = [];
  private merge = 0;
  private mergeV = 0;
  private time = 0;
  private tmp = new Vector3();
  reduced: boolean;

  constructor(
    private kit: SceneKit,
    private fx: Fx,
    private cb: RigCallbacks,
    reduced: boolean,
    readonly palette: PaletteState,
  ) {
    this.reduced = reduced;
    this.shared = createShared(kit.tier.particles > 4200 ? kit.tier.particles : 4200);
    for (let i = 0; i < 5; i++) {
      const o = new Orb(this.shared, this.palette);
      this.pool.push(o);
      kit.scene.add(o.group);
    }
    this.applyQuality();
  }

  get mergedAmount(): number {
    return this.merge;
  }

  /** Probe for tests: per slot orb x, y, radius, grow. */
  debugState(): number[][] {
    return this.slotOrb.map((o) => (o ? [o.pos.x, o.pos.y, o.radius, o.grow].map((v) => +v.toFixed(2)) : []));
  }

  /** Largest visible orb grow, for audio. */
  get energy(): number {
    return Math.max(0, ...this.slotOrb.map((o) => (o ? o.grow : 0)));
  }

  applyQuality(): void {
    const n = Math.round(this.kit.tier.particles * (this.reduced ? 0.5 : 1));
    this.shared.particles.setDrawRange(0, n);
  }

  private acquire(): Orb {
    const o = this.pool.find((p) => !p.inUse) ?? this.pool[0]!;
    o.inUse = true;
    o.lastTarget = null;
    o.lastRadius = null;
    o.grow = 0;
    o.implode = 0;
    o.inflow = 1;
    o.intensity = 1;
    o.flash = 0;
    o.vel.set(0, 0, 0);
    o.radiusVel = 0;
    return o;
  }

  /** The visible orb pose for a slot, for FX anchoring. */
  orbPosition(slot: number, out: Vector3): Vector3 {
    const o = this.slotOrb[slot];
    return o ? out.copy(o.pos) : out.set(0, 0, 0);
  }

  orbRadius(slot: number): number {
    return this.slotOrb[slot]?.radius ?? 1;
  }

  handle(ev: BrainEvent, merged: boolean): void {
    switch (ev.type) {
      case 'implode': {
        const o = this.slotOrb[ev.slot];
        if (o) {
          this.fx.implode(o.pos, o.radius);
          o.flash = 1;
        }
        break;
      }
      case 'launch':
        this.launch(ev.slot, merged || ev.merged);
        break;
      case 'merge':
      case 'split':
        for (const o of this.slotOrb) if (o) o.flash = Math.max(o.flash, 0.9);
        break;
      default:
        break;
    }
  }

  private launch(slot: number, merged: boolean): void {
    const carrier = this.slotOrb[merged ? 0 : slot];
    if (!carrier) return;
    this.slotOrb[merged ? 0 : slot] = null;
    if (merged) {
      const other = this.slotOrb[1];
      if (other) {
        other.inUse = false;
        other.grow = 0;
        this.slotOrb[1] = null;
      }
      this.merge = 0;
      this.mergeV = 0;
    }
    carrier.flash = 0.5;
    this.projectiles.push({ orb: carrier, age: 0, dur: 0.4, from: carrier.pos.clone(), power: merged ? 1.7 : 1 });
  }

  update(dt: number, frame: BrainFrame, map: ViewMap): void {
    this.time += dt;
    this.palette.step(dt);

    // targets per slot
    frame.slots.forEach((s, i) => {
      let o = this.slotOrb[i] ?? null;
      if (!o && s.present && s.charge > 0.005) {
        o = this.acquire();
        const [x, y] = this.handTarget(s, map);
        o.pos.set(x, y, 0);
        o.radius = this.handRadius(s, map);
        this.slotOrb[i] = o;
      }
      if (!o) return;
      if (s.present) {
        const [x, y] = this.handTarget(s, map);
        o.tips.forEach((t, k) => {
          const tip = s.tips[k];
          if (!tip) return;
          const [tx, ty] = videoToWorld(map, tip.x, tip.y);
          const r = Math.max(o!.radius, 1e-3);
          t.set((tx - o!.pos.x) / r, (ty - o!.pos.y) / r, 0);
          const m = t.length();
          if (m > 5) t.multiplyScalar(5 / m);
        });
        (o.lastTarget ??= new Vector3()).set(x, y, 0);
        o.lastRadius = this.handRadius(s, map);
      }
    });

    // merge spring
    const mTarget = frame.merged ? 1 : 0;
    [this.merge, this.mergeV] = spring.step(this.merge, this.mergeV, mTarget, dt, 11, 0.7);
    const m = clamp01(this.merge);

    const a = this.slotOrb[0], b = this.slotOrb[1];
    const midPos = new Vector3();
    let midR = 1;
    if (a && b) {
      const pa = a.lastTarget ?? a.pos, pb = b.lastTarget ?? b.pos;
      midPos.copy(pa).add(pb).multiplyScalar(0.5);
      midR = Math.hypot(a.lastRadius ?? a.radius, b.lastRadius ?? b.radius) * 1.2;
    }

    this.slotOrb.forEach((o, i) => {
      if (!o) return;
      const s = frame.slots[i]!;
      let tp = o.lastTarget ?? o.pos;
      let tr = o.lastRadius ?? o.radius;
      let hidden = 1;
      if (a && b && m > 0.001) {
        tp = this.tmp.copy(tp).lerp(midPos, m);
        tr = tr + ((i === 0 ? midR : tr * 0.2) - tr) * m;
        hidden = i === 0 ? 1 : 1 - m;
      }
      let v: number;
      [o.pos.x, v] = spring.step(o.pos.x, o.vel.x, tp.x, dt, 17, 0.55);
      o.vel.x = v;
      [o.pos.y, v] = spring.step(o.pos.y, o.vel.y, tp.y, dt, 17, 0.55);
      o.vel.y = v;
      [o.radius, o.radiusVel] = spring.step(o.radius, o.radiusVel, Math.max(tr, 1e-3), dt, 14, 0.5);

      // visual charge: grows from a spark, eases out
      const c = s.charge;
      const gTarget = c > 0.004 ? 0.1 + 0.9 * easeOutCubic(c) : 0;
      o.grow = damp(o.grow, gTarget, gTarget < o.grow ? 22 : 30, dt) * hidden;
      if (!s.present && c <= 0 && o.grow < 0.01) {
        o.inUse = false;
        o.grow = 0;
        this.slotOrb[i] = null;
        return;
      }
      const inflowT = c < 0.995 && s.gesture !== 'fist' ? 1 : 0.1;
      o.inflow = damp(o.inflow, s.imploding ? 0 : inflowT, 4, dt);
      o.implode = damp(o.implode, s.imploding ? 1 : 0, s.imploding ? 14 : 6, dt);
      o.intensity = (1 + 0.3 * m * (i === 0 ? 1 : 0)) * (0.85 + 0.15 * clamp01(c * 1.2));
      o.flash = damp(o.flash, 0, 5, dt);
    });

    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.age += dt;
      const t = clamp01(p.age / p.dur);
      const e = t * t;
      p.orb.pos.set(p.from.x * (1 - 0.35 * e), p.from.y * (1 - 0.35 * e), 8.2 * e);
      p.orb.intensity = 1 + 1.6 * e;
      p.orb.inflow = 0;
      p.orb.flash = 0.4 * e;
      p.orb.grow = 1;
      this.sync(p.orb);
      if (t >= 1) {
        this.tmp.set(p.from.x * 0.65, p.from.y * 0.65, 0);
        this.fx.burst(this.tmp, p.orb.radius, p.power);
        this.cb.onBurst(p.power);
        p.orb.inUse = false;
        p.orb.grow = 0;
        p.orb.group.visible = false;
        this.projectiles.splice(i, 1);
      }
    }

    this.slotOrb.forEach((o) => o && this.sync(o));
  }

  private sync(o: Orb): void {
    const sq = { x: 1 + Math.min(0.14, Math.abs(o.vel.x) * 0.012), y: 1 + Math.min(0.14, Math.abs(o.vel.y) * 0.012) };
    const sp = Math.hypot(o.vel.x, o.vel.y);
    o.sync(this.time, this.kit.pxPerWorld, sq, Math.min(0.22, sp * 0.02));
  }

  private handTarget(s: SlotView, map: ViewMap): [number, number] {
    // hover just above the palm centre, towards the fingers
    const off = s.size * 0.4;
    return videoToWorld(map, s.center.x + s.up.x * off, s.center.y + s.up.y * off);
  }

  private handRadius(s: SlotView, map: ViewMap): number {
    return Math.max(0.2, lengthToWorld(map, s.size) * 0.55);
  }

  dispose(): void {
    for (const o of this.pool) {
      o.dispose();
      this.kit.scene.remove(o.group);
    }
    disposeShared(this.shared);
  }
}
