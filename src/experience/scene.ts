// Renderer, bloom composer and adaptive quality. The canvas is opaque black and blended over
// the mirrored <video> with CSS `mix-blend-mode: screen`, which for additive light is equivalent
// to compositing it onto the video, and keeps bloom simple.

import { PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CAMERA_DIST, CAMERA_FOV } from './coords';

export interface QualityTier {
  name: string;
  pixelRatio: number;
  particles: number;
  bloomScale: number;
}

export const TIERS: readonly QualityTier[] = [
  { name: 'low', pixelRatio: 1, particles: 1200, bloomScale: 0.4 },
  { name: 'medium', pixelRatio: 1.5, particles: 2600, bloomScale: 0.6 },
  { name: 'high', pixelRatio: 2, particles: 4200, bloomScale: 0.8 },
];

export const FPS_FLOOR = 45;
export const FPS_WINDOW = 2; // seconds below the floor before dropping a tier

export function isMobile(): boolean {
  return matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
}

export class SceneKit {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 60);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private w = 1;
  private h = 1;
  quality: number;
  /** Called after an automatic quality drop. */
  onQuality: ((q: number) => void) | null = null;
  private pinned: boolean;
  private acc = 0;
  private frames = 0;
  private lowFor = 0;
  private warm = 0;

  constructor(
    readonly host: HTMLElement,
    opts: { quality?: number | null } = {},
  ) {
    const mobile = isMobile();
    this.pinned = opts.quality != null;
    this.quality = opts.quality ?? (mobile ? 1 : 2);
    this.renderer = new WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    const el = this.renderer.domElement;
    el.className = 'fx-canvas';
    el.setAttribute('aria-hidden', 'true');
    host.append(el);

    this.camera.position.set(0, 0, CAMERA_DIST);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.6, 0.5, 0.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.applyQuality();
  }

  get tier(): QualityTier {
    return TIERS[this.quality] ?? TIERS[0]!;
  }

  /** Pixels per world unit at the z = 0 plane (for point sizes). */
  get pxPerWorld(): number {
    return (this.h * this.renderer.getPixelRatio()) / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360) * CAMERA_DIST);
  }

  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  private applyQuality(): void {
    const t = this.tier;
    const pr = Math.min(window.devicePixelRatio || 1, t.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.setSize(this.w, this.h);
    this.bloom.resolution.set(Math.max(64, this.w * t.bloomScale), Math.max(64, this.h * t.bloomScale));
  }

  setQuality(q: number): void {
    const next = Math.max(0, Math.min(TIERS.length - 1, q));
    if (next === this.quality) return;
    this.quality = next;
    this.applyQuality();
  }

  setSize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.renderer.setSize(this.w, this.h);
    this.composer.setSize(this.w, this.h);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    const t = this.tier;
    this.bloom.resolution.set(Math.max(64, this.w * t.bloomScale), Math.max(64, this.h * t.bloomScale));
  }

  render(): void {
    this.composer.render();
  }

  /** Feed the frame time; drops a quality tier if fps stays under the floor for a couple of seconds. */
  trackFps(dt: number): void {
    if (this.pinned || document.hidden) return;
    this.warm += dt;
    if (this.warm < 2) return;
    this.acc += dt;
    this.frames++;
    if (this.acc < 0.5) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    this.lowFor = fps < FPS_FLOOR ? this.lowFor + 0.5 : 0;
    if (this.lowFor >= FPS_WINDOW && this.quality > 0) {
      this.lowFor = 0;
      this.warm = 0; // let the new tier settle before judging it
      this.setQuality(this.quality - 1);
      this.onQuality?.(this.quality);
    }
  }

  resetFps(): void {
    this.acc = 0;
    this.frames = 0;
    this.lowFor = 0;
    this.warm = 0;
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
