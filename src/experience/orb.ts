// The orb: spiral core, counter-rotating shell, orbiting/inflowing particles and a soft glow.

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
  SphereGeometry,
  Vector3,
} from 'three';
import {
  CORE_FRAG,
  GLOW_FRAG,
  GLOW_VERT,
  PARTICLE_FRAG,
  PARTICLE_VERT,
  SHELL_FRAG,
  SPHERE_VERT,
} from './shaders';

export interface Palette {
  name: string;
  /** hot core, mid, rim */
  a: string;
  b: string;
  c: string;
}

export const PALETTES: readonly Palette[] = [
  { name: 'azure', a: '#d4f1ff', b: '#2f9bff', c: '#3a4cff' },
  { name: 'crimson', a: '#ffd6cc', b: '#ff3350', c: '#b0002e' },
  { name: 'violet', a: '#efdcff', b: '#a255ff', c: '#5a2bff' },
  { name: 'gold', a: '#fff1bd', b: '#ffb81f', c: '#ff6a00' },
  { name: 'toxic green', a: '#eaffc6', b: '#74ff2b', c: '#00c46a' },
];

/** Shared, smoothly interpolating colours referenced by every orb and effect. */
export class PaletteState {
  index = 0;
  readonly a = new Color(PALETTES[0]!.a);
  readonly b = new Color(PALETTES[0]!.b);
  readonly c = new Color(PALETTES[0]!.c);
  private ta = new Color(PALETTES[0]!.a);
  private tb = new Color(PALETTES[0]!.b);
  private tc = new Color(PALETTES[0]!.c);

  get current(): Palette {
    return PALETTES[this.index]!;
  }

  next(): Palette {
    this.index = (this.index + 1) % PALETTES.length;
    const p = this.current;
    this.ta.set(p.a);
    this.tb.set(p.b);
    this.tc.set(p.c);
    return p;
  }

  step(dt: number): void {
    const k = 1 - Math.exp(-dt * 7);
    this.a.lerp(this.ta, k);
    this.b.lerp(this.tb, k);
    this.c.lerp(this.tc, k);
  }
}

export interface OrbShared {
  sphere: SphereGeometry;
  plane: PlaneGeometry;
  particles: BufferGeometry;
  maxParticles: number;
}

export function createShared(maxParticles: number): OrbShared {
  const geo = new BufferGeometry();
  const seeds = new Float32Array(maxParticles * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(maxParticles * 3), 3));
  geo.setAttribute('aSeed', new BufferAttribute(seeds, 4));
  // Particles are positioned in the vertex shader; never frustum-cull them.
  geo.boundingSphere = null;
  return {
    sphere: new SphereGeometry(1, 56, 40),
    plane: new PlaneGeometry(2, 2),
    particles: geo,
    maxParticles,
  };
}

export function disposeShared(s: OrbShared): void {
  s.sphere.dispose();
  s.plane.dispose();
  s.particles.dispose();
}

const sphereMat = (frag: string, u: Record<string, { value: unknown }>) =>
  new ShaderMaterial({
    vertexShader: SPHERE_VERT,
    fragmentShader: frag,
    uniforms: u,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });

export class Orb {
  readonly group = new Group();
  // physical state (driven by the rig)
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  radius = 1;
  radiusVel = 0;
  // visual state
  grow = 0;
  implode = 0;
  inflow = 1;
  intensity = 1;
  flash = 0;
  inUse = false;
  /** Last hand-derived target pose (kept while the hand is briefly lost). */
  lastTarget: Vector3 | null = null;
  lastRadius: number | null = null;
  readonly tips = Array.from({ length: 5 }, () => new Vector3());

  private core: Mesh;
  private shell: Mesh;
  private glow: Mesh;
  private points: Points;
  private u: Record<string, { value: unknown }>;
  private pu: Record<string, { value: unknown }>;
  private gu: Record<string, { value: unknown }>;
  private seedOff = Math.random();

  constructor(
    shared: OrbShared,
    palette: PaletteState,
  ) {
    this.u = {
      uTime: { value: 0 },
      uCharge: { value: 0 },
      uIntensity: { value: 1 },
      uFlash: { value: 0 },
      uWobble: { value: 0.06 },
      uA: { value: palette.a },
      uB: { value: palette.b },
      uC: { value: palette.c },
    };
    this.core = new Mesh(shared.sphere, sphereMat(CORE_FRAG, this.u));
    this.shell = new Mesh(shared.sphere, sphereMat(SHELL_FRAG, this.u));
    this.core.renderOrder = 2;
    this.shell.renderOrder = 3;

    this.gu = { uColor: { value: palette.b }, uStrength: { value: 0 } };
    this.glow = new Mesh(
      shared.plane,
      new ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        uniforms: this.gu,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    );
    this.glow.renderOrder = 1;

    this.pu = {
      uTime: { value: 0 },
      uCharge: { value: 0 },
      uInflow: { value: 1 },
      uImplode: { value: 0 },
      uPxPerWorld: { value: 100 },
      uScale: { value: 1 },
      uSeedOff: { value: this.seedOff },
      uTips: { value: this.tips },
      uIntensity: { value: 1 },
      uA: { value: palette.a },
      uB: { value: palette.b },
    };
    this.points = new Points(
      shared.particles,
      new ShaderMaterial({
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        uniforms: this.pu,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;

    this.group.add(this.glow, this.core, this.shell, this.points);
    this.group.visible = false;
  }

  setParticleCount(n: number): void {
    this.points.geometry.setDrawRange(0, n);
  }

  /** Push the physical + visual state into the shader uniforms. */
  sync(time: number, pxPerWorld: number, squash: { x: number; y: number }, wobble: number): void {
    const visible = this.grow > 0.004 || this.implode > 0.01;
    this.group.visible = visible && this.inUse;
    if (!this.group.visible) return;
    const pulse = 1 + 0.035 * Math.sin(time * 5.3) + 0.02 * Math.sin(time * 9.1 + 1.3);
    this.group.position.copy(this.pos);
    this.group.scale.set(this.radius * squash.x, this.radius * squash.y, this.radius);
    this.core.scale.setScalar(this.grow * pulse);
    this.shell.scale.setScalar(this.grow * pulse * 1.13);
    const gs = (0.9 + 1.9 * this.grow) * (1 + 0.5 * this.flash);
    this.glow.scale.setScalar(gs);
    this.u['uTime']!.value = time;
    this.u['uCharge']!.value = this.grow;
    this.u['uIntensity']!.value = this.intensity;
    this.u['uFlash']!.value = this.flash * 0.6;
    this.u['uWobble']!.value = 0.05 + wobble;
    this.gu['uStrength']!.value = (0.04 + 0.1 * this.grow) * this.intensity * (1 + this.flash);
    this.pu['uTime']!.value = time;
    this.pu['uCharge']!.value = this.grow;
    this.pu['uInflow']!.value = this.inflow;
    this.pu['uImplode']!.value = this.implode;
    this.pu['uPxPerWorld']!.value = pxPerWorld;
    this.pu['uScale']!.value = this.radius;
    this.pu['uIntensity']!.value = this.intensity;
  }

  dispose(): void {
    for (const m of [this.core, this.shell, this.glow, this.points]) (m.material as ShaderMaterial).dispose();
  }
}
