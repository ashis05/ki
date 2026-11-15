// Bursts: shockwave ring + sparks (launch/merge), inward collapse (fist), screen shake and flash.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  type Vector3,
} from 'three';
import { GLOW_VERT, RING_FRAG, SPARK_FRAG, SPARK_VERT } from './shaders';
import type { PaletteState } from './orb';

const SPARKS = 420;

interface Slot {
  ring: Mesh;
  ringU: Record<string, { value: unknown }>;
  sparks: Points;
  sparkU: Record<string, { value: unknown }>;
  age: number;
  dur: number;
  active: boolean;
}

export class Fx {
  readonly group = new Group();
  /** Screen shake amplitude in CSS px (decays). */
  shake = 0;
  /** Screen flash 0..1 (decays). */
  flash = 0;
  private slots: Slot[] = [];
  private geo: BufferGeometry;
  private plane = new PlaneGeometry(2, 2);
  private hot = new Color('#ffffff');

  constructor(
    private palette: PaletteState,
    private reduced: boolean,
    pool = 4,
  ) {
    this.geo = new BufferGeometry();
    const seeds = new Float32Array(SPARKS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.geo.setAttribute('position', new BufferAttribute(new Float32Array(SPARKS * 3), 3));
    this.geo.setAttribute('aSeed', new BufferAttribute(seeds, 4));
    this.geo.boundingSphere = null;
    for (let i = 0; i < pool; i++) this.slots.push(this.makeSlot());
  }

  private makeSlot(): Slot {
    const ringU = {
      uColor: { value: this.palette.b },
      uHot: { value: this.hot },
      uT: { value: 0 },
    };
    const ring = new Mesh(
      this.plane,
      new ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: RING_FRAG,
        uniforms: ringU,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    );
    ring.visible = false;
    ring.renderOrder = 6;
    const sparkU = {
      uT: { value: 0 },
      uLife: { value: 1 },
      uSize: { value: 0.1 },
      uSpeed: { value: 5 },
      uMode: { value: 0 },
      uPxPerWorld: { value: 100 },
      uA: { value: this.palette.a },
      uB: { value: this.palette.b },
    };
    const sparks = new Points(
      this.geo.clone(),
      new ShaderMaterial({
        vertexShader: SPARK_VERT,
        fragmentShader: SPARK_FRAG,
        uniforms: sparkU,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    );
    sparks.frustumCulled = false;
    sparks.visible = false;
    sparks.renderOrder = 7;
    this.group.add(ring, sparks);
    return { ring, ringU, sparks, sparkU, age: 0, dur: 1, active: false };
  }

  private take(): Slot {
    return this.slots.find((s) => !s.active) ?? this.slots.reduce((a, b) => (a.age > b.age ? a : b));
  }

  /** Outward burst at `at`; `size` is world units (orb radius). */
  burst(at: Vector3, size: number, power = 1): void {
    const s = this.take();
    s.active = true;
    s.age = 0;
    s.dur = 1.25;
    const extent = Math.max(size * 5.5 * power, 6);
    s.ring.position.copy(at);
    s.ring.scale.setScalar(extent);
    s.ring.visible = true;
    s.sparks.position.copy(at);
    s.sparks.visible = true;
    s.sparkU['uMode']!.value = 0;
    s.sparkU['uLife']!.value = 1.1;
    s.sparkU['uSize']!.value = size * 0.16;
    s.sparkU['uSpeed']!.value = extent * 0.9;
    s.sparks.geometry.setDrawRange(0, this.reduced ? SPARKS / 2 : SPARKS);
    this.shake = Math.max(this.shake, this.reduced ? 0 : 16 * power);
    this.flash = Math.max(this.flash, (this.reduced ? 0.2 : 0.75) * Math.min(1, power));
  }

  /** Inward collapse flash (fist). */
  implode(at: Vector3, size: number): void {
    const s = this.take();
    s.active = true;
    s.age = 0;
    s.dur = 0.55;
    s.ring.visible = false;
    s.sparks.position.copy(at);
    s.sparks.visible = true;
    s.sparkU['uMode']!.value = 1;
    s.sparkU['uLife']!.value = 0.5;
    s.sparkU['uSize']!.value = size * 0.13;
    s.sparkU['uSpeed']!.value = size * 3.2;
    s.sparks.geometry.setDrawRange(0, this.reduced ? SPARKS / 4 : SPARKS / 2);
    this.flash = Math.max(this.flash, this.reduced ? 0.04 : 0.18);
  }

  update(dt: number, pxPerWorld: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.dur) {
        s.active = false;
        s.ring.visible = false;
        s.sparks.visible = false;
        continue;
      }
      s.ringU['uT']!.value = Math.min(1, s.age / 1.0);
      s.sparkU['uT']!.value = s.age;
      s.sparkU['uPxPerWorld']!.value = pxPerWorld;
    }
    this.shake *= Math.exp(-dt * 7);
    if (this.shake < 0.05) this.shake = 0;
    this.flash *= Math.exp(-dt * 5.5);
    if (this.flash < 0.01) this.flash = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.plane.dispose();
    for (const s of this.slots) {
      s.sparks.geometry.dispose();
      (s.ring.material as ShaderMaterial).dispose();
      (s.sparks.material as ShaderMaterial).dispose();
    }
  }
}
