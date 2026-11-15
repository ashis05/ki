import * as THREE from 'three';
import { MindARThree, type MindARAnchor } from 'mind-ar/dist/mindar-image-three.prod.js';
import { assets } from '../content';
import { url } from '../dom';
import { ArError, probeCamera } from './errors';
import { buildPanels, type PanelSet } from './panels';

/** MindAR tuning. Lower filterMinCF = steadier when still; higher missTolerance = fewer flickers. */
const TRACKING = {
  maxTrack: 1,
  filterMinCF: 0.0005,
  filterBeta: 1000,
  warmupTolerance: 5,
  missTolerance: 10,
} as const;

const VIDEO_WIDTH = 1; // card width = 1; 16:9 fits inside the card so panels never overlap it
const VIDEO_Z = 0.02;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

export interface SessionEvents {
  onStage(text: string): void;
  onFound(): void;
  onLost(): void;
  /** Aspect (height / width) of the tracked target, once known. */
  onTargetRatio(ratio: number): void;
}

/** Same-origin path override so the e2e test can track a synthetic card. */
function resolveTarget(): string {
  const q = new URLSearchParams(location.search).get('target');
  if (q && q.startsWith('/') && !q.startsWith('//')) return q;
  return url(assets.target);
}

export class ArSession {
  private mindar: MindARThree | null = null;
  private videoEl: HTMLVideoElement;
  private plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private panels: PanelSet | null = null;
  private running = false;
  private starting: Promise<void> | null = null;
  private wantRunning = false;
  private found = false;
  private shown = 0; // 0..1 eased visibility of the video plane
  private lastT = 0;
  private cameraOn = false;
  private anchors: MindARAnchor[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly events: SessionEvents,
  ) {
    this.videoEl = document.createElement('video');
    this.videoEl.muted = true;
    this.videoEl.loop = true;
    this.videoEl.playsInline = true;
    this.videoEl.setAttribute('playsinline', '');
    this.videoEl.setAttribute('webkit-playsinline', '');
    this.videoEl.preload = 'none'; // nothing is downloaded until AR starts
    this.videoEl.crossOrigin = 'anonymous';
    this.videoEl.src = url(assets.video);
  }

  get isActive(): boolean {
    return this.wantRunning;
  }

  /** Start (or restart after a stop). Throws ArError. */
  async start(): Promise<void> {
    this.wantRunning = true;
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    this.events.onStage('Waiting for camera permission…');
    await probeCamera();
    if (!this.wantRunning) return;

    this.events.onStage('Starting the card tracker…');
    this.videoEl.preload = 'auto';
    this.videoEl.load();

    const first = !this.mindar;
    if (!this.mindar) this.mindar = this.build();
    const mindar = this.mindar;

    this.cameraOn = true;
    try {
      await mindar.start();
    } catch (err) {
      this.teardownCamera();
      if (err instanceof ArError) throw err;
      throw new ArError('target', 'Could not load the card target or start tracking.');
    }
    if (!this.wantRunning) {
      this.teardownCamera();
      return;
    }

    if (first) this.onReady(mindar);
    this.running = true;
    this.lastT = performance.now();
    mindar.renderer.setAnimationLoop(this.frame);
    this.events.onStage('');
  }

  private build(): MindARThree {
    const mindar = new MindARThree({
      container: this.container,
      imageTargetSrc: resolveTarget(),
      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no',
      ...TRACKING,
    });
    // CSS layer must not swallow taps meant for the camera UI; the anchored elements
    // opt back in (CSS3DRenderer sets pointer-events:auto on them).
    mindar.cssRenderer.domElement.style.pointerEvents = 'none';
    mindar.cssRenderer.domElement.classList.add('ar-css-layer');
    mindar.renderer.domElement.classList.add('ar-gl-layer');
    return mindar;
  }

  /** One-time scene construction, after the first successful start (target dimensions known). */
  private onReady(mindar: MindARThree) {
    const post = mindar.postMatrixs[0];
    const ratio = post ? (post.elements[13] ?? 0.3) * 2 / (post.elements[0] || 1) : 0.571;
    this.events.onTargetRatio(ratio);

    // WebGL anchor: video plane
    const tex = new THREE.VideoTexture(this.videoEl);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(VIDEO_WIDTH, (VIDEO_WIDTH * 9) / 16), material);
    plane.position.z = VIDEO_Z;
    plane.visible = false;
    this.plane = plane;
    const glAnchor = mindar.addAnchor(0);
    this.anchors.push(glAnchor);
    glAnchor.group.add(plane);

    // CSS anchor: real HTML
    const cssAnchor = mindar.addCSSAnchor(0);
    this.anchors.push(cssAnchor);
    this.panels = buildPanels(ratio, VIDEO_Z);
    for (const o of this.panels.objects) cssAnchor.group.add(o);

    glAnchor.onTargetFound = () => this.setFound(true);
    glAnchor.onTargetLost = () => this.setFound(false);
  }

  private setFound(found: boolean) {
    if (this.found === found) return;
    this.found = found;
    if (found) {
      void this.videoEl.play().catch(() => {
        // Autoplay refused: retry on the next tap (a user gesture).
        const retry = () => void this.videoEl.play().catch(() => undefined);
        window.addEventListener('pointerdown', retry, { once: true });
      });
      this.events.onFound();
    } else {
      this.videoEl.pause();
      this.events.onLost();
    }
    this.panels?.setVisible(found);
  }

  private frame = (t: number) => {
    const mindar = this.mindar;
    if (!mindar || !this.running) return;
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;

    if (this.plane) {
      const target = this.found ? 1 : 0;
      this.shown = REDUCED_MOTION.matches
        ? target
        : this.shown + (target - this.shown) * (1 - Math.exp(-dt * 7));
      if (Math.abs(this.shown - target) < 0.002) this.shown = target;
      this.plane.visible = this.shown > 0.001;
      this.plane.material.opacity = this.shown;
      const s = REDUCED_MOTION.matches ? 1 : 0.9 + 0.1 * this.shown;
      this.plane.scale.set(s, s, 1);
    }

    mindar.renderer.render(mindar.scene, mindar.camera);
    mindar.cssRenderer.render(mindar.cssScene, mindar.camera);
  };

  /** Stop camera + tracking and release the loop. Safe to call any time. */
  async stop(): Promise<void> {
    this.wantRunning = false;
    if (this.starting) await this.starting.catch(() => undefined);
    this.teardownCamera();
  }

  private teardownCamera() {
    if (this.found) this.setFound(false);
    this.shown = 0;
    this.videoEl.pause();
    // MindAR only fires found/lost on visibility *changes*; reset so a restart re-fires.
    for (const a of this.anchors) a.visible = false;
    for (const el of this.panels?.elements ?? []) el.style.visibility = 'hidden';
    const mindar = this.mindar;
    if (!mindar || !this.cameraOn) return;
    this.cameraOn = false;
    this.running = false;
    mindar.renderer.setAnimationLoop(null);
    try {
      mindar.stop();
      mindar.controller.dispose();
    } catch {
      // camera never fully started
    }
  }
}
