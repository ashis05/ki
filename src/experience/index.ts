// Orchestrates camera, hand tracking, gestures, orbs, FX, audio and the render loop.

import { Sfx } from './audio';
import { Camera, ExperienceError, support, type Facing } from './camera';
import type { ViewMap } from './coords';
import { Fx } from './fx';
import { Brain, handFeatures, type BrainEvent, type BrainFrame, type RawHand } from './gestures';
import { HandTracker } from './hands';
import { PALETTES, PaletteState } from './orb';
import { OrbRig } from './rig';
import { SceneKit, isMobile } from './scene';
import { snap } from './snap';

export { ExperienceError } from './camera';
export type { ErrorKind } from './camera';

export interface ExperienceUI {
  /** Holds the video and the effects canvas; shaken on bursts. */
  stage: HTMLElement;
  video: HTMLVideoElement;
  hint: HTMLElement;
  flash: HTMLElement;
  status(text: string): void;
  palette(name: string, hex: string): void;
  canFlip(v: boolean): void;
  toast(text: string): void;
}

interface Debug {
  frames: number;
  detects: number;
  hands: number;
  errors: number;
  delegate: string;
  fake: string;
  quality: number;
  merged: boolean;
  charge: number[];
  gesture: string[];
  counts: Record<string, number>;
  palette: string;
  merge: number;
  orbs: number[][];
  /** Features of the first detected hand (non-production probe). */
  feat: Record<string, number | string>;
}

// Non-production only: `?fake=` scripted hands and a `window.__ki` probe for the e2e test.
// The literal comparison is folded at build time, so production bundles contain none of it.
const DEV_HOOKS = import.meta.env.MODE !== 'production';

export class Experience {
  private camera: Camera;
  private kit: SceneKit | null = null;
  private fx: Fx | null = null;
  private rig: OrbRig | null = null;
  private sfx: Sfx | null = null;
  private tracker: HandTracker | null = null;
  private trackerP: Promise<HandTracker> | null = null;
  private brain: Brain | null = null;
  private brainW = 0;
  private raf = 0;
  private running = false;
  private lastNow = 0;
  private lastFrame: BrainFrame | null = null;
  private noHandSince = 0;
  private hintShown = false;
  private launchHinted = false;
  private launchHintUntil = 0;
  private fakeFn: ((t: number, vw: number, vh: number) => RawHand[]) | null = null;
  private fakeT0 = 0;
  private ro: ResizeObserver | null = null;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // `hold` freezes animation time (rig + fx) so tests can capture an exact moment;
  // `advance` then lets a given number of seconds through, once.
  private probe: { debug: Debug; hold: boolean; advance: number } = { debug: null as never, hold: false, advance: 0 };
  private debug: Debug = {
    frames: 0, detects: 0, hands: 0, errors: 0, delegate: '', fake: '', quality: 0, merged: false,
    charge: [], gesture: [], counts: {}, palette: PALETTES[0]!.name, merge: 0, orbs: [], feat: {},
  };

  constructor(
    private ui: ExperienceUI,
    audioCtx: AudioContext | null,
  ) {
    this.camera = new Camera(ui.video);
    if (audioCtx) {
      try {
        this.sfx = new Sfx(audioCtx);
      } catch {
        this.sfx = null;
      }
    }
    this.probe.debug = this.debug;
    if (DEV_HOOKS) (window as unknown as { __ki: unknown }).__ki = this.probe;
  }

  get muted(): boolean {
    return this.sfx?.isMuted ?? true;
  }

  get isRunning(): boolean {
    return this.running;
  }

  cyclePalette(): void {
    if (!this.rig) return;
    const p = this.rig.palette.next();
    this.ui.palette(p.name, p.b);
    this.debug.palette = p.name;
    this.sfx?.tick();
  }

  get hasAudio(): boolean {
    return this.sfx !== null;
  }

  toggleMute(): boolean {
    if (!this.sfx) return true;
    this.sfx.setMuted(!this.sfx.isMuted);
    return this.sfx.isMuted;
  }

  async start(): Promise<void> {
    const s = support();
    if (!s.ok) throw new ExperienceError(s.kind);
    this.sfx?.resume();

    if (!this.kit) this.createScene();

    if (DEV_HOOKS && !this.fakeFn) {
      const name = new URLSearchParams(location.search).get('fake');
      if (name) {
        const { fakeHands, FAKE_MODES } = await import('./fake');
        if ((FAKE_MODES as readonly string[]).includes(name)) {
          this.debug.fake = name;
          this.fakeFn = (t, vw, vh) => fakeHands(name as (typeof FAKE_MODES)[number], t, vw, vh);
        }
      }
    }

    this.ui.status('Starting camera…');
    const needTracker = !this.fakeFn && !this.tracker;
    if (needTracker) {
      this.trackerP ??= HandTracker.create((t) => this.ui.status(t));
      this.trackerP.catch(() => (this.trackerP = null));
    }
    await this.camera.start();
    this.ui.canFlip(this.camera.multiple);
    this.ui.video.classList.toggle('is-mirrored', this.camera.mirrored);
    if (needTracker) {
      this.ui.status('Loading hand tracker…');
      this.tracker = await this.trackerP!;
    }
    this.ui.status('');
    this.begin();
  }

  private createScene(): void {
    const q = new URLSearchParams(location.search).get('q');
    const pinned = q !== null && /^[0-2]$/.test(q) ? Number(q) : null;
    try {
      this.kit = new SceneKit(this.ui.stage, { quality: pinned });
    } catch {
      throw new ExperienceError('webgl');
    }
    const kit = this.kit;
    const palette = new PaletteState();
    this.fx = new Fx(palette, this.reduced);
    kit.scene.add(this.fx.group);
    this.rig = new OrbRig(kit, this.fx, { onBurst: (p) => {
          this.count('burst');
          this.sfx?.boom(p);
        },
      }, this.reduced, palette);
    kit.onQuality = () => {
      this.rig?.applyQuality();
      this.debug.quality = kit.quality;
    };
    this.debug.quality = kit.quality;
    this.ui.palette(palette.current.name, palette.current.b);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.ui.stage);
    this.resize();
  }

  private resize(): void {
    this.kit?.setSize(this.ui.stage.clientWidth, this.ui.stage.clientHeight);
  }

  private begin(): void {
    if (this.running) return;
    this.running = true;
    this.lastNow = performance.now();
    this.fakeT0 = this.lastNow;
    this.noHandSince = this.lastNow;
    this.kit?.resetFps();
    this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  /** Stop camera + loop (tab hidden or closed). */
  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.camera.stop();
    this.sfx?.setCharge(0);
    this.sfx?.suspend();
  }

  async resume(): Promise<void> {
    if (this.running) return;
    await this.start();
  }

  stop(): void {
    this.pause();
    this.ui.hint.classList.remove('is-on');
    this.ui.stage.style.transform = '';
    this.ui.flash.style.opacity = '0';
  }

  async flip(): Promise<void> {
    const next: Facing = this.camera.facing === 'user' ? 'environment' : 'user';
    try {
      await this.camera.start(next);
    } catch {
      await this.camera.start(this.camera.facing === 'user' ? 'environment' : 'user').catch(() => undefined);
    }
    this.ui.video.classList.toggle('is-mirrored', this.camera.mirrored);
    this.brain = null;
  }

  async snap(): Promise<void> {
    if (!this.kit) return;
    try {
      const how = await snap(this.ui.video, this.kit, this.camera.mirrored, isMobile());
      this.ui.toast(how === 'shared' ? 'Shared' : 'Saved to downloads');
    } catch {
      this.ui.toast('Could not save the picture');
    }
  }

  private count(k: string): void {
    this.debug.counts[k] = (this.debug.counts[k] ?? 0) + 1;
  }

  private onEvent(ev: BrainEvent, frame: BrainFrame): void {
    this.count(ev.type);
    const rig = this.rig!;
    if (ev.type === 'pinch') {
      this.cyclePalette();
      return;
    }
    if (ev.type === 'launch') this.sfx?.whoosh();
    if (ev.type === 'implode') this.sfx?.implode();
    if (ev.type === 'charged' && !this.launchHinted) {
      this.launchHinted = true;
      this.launchHintUntil = performance.now() + 3500;
    }
    rig.handle(ev, frame.merged);
  }

  private tick(now: number): void {
    if (!this.running) return;
    this.raf = requestAnimationFrame((n) => this.tick(n));
    const kit = this.kit!, rig = this.rig!;
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const video = this.ui.video;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;

    if (!this.brain || this.brainW !== vw) {
      this.brain = new Brain(vw);
      this.brainW = vw;
    }

    let hands: RawHand[] | undefined;
    if (this.fakeFn) hands = this.fakeFn((now - this.fakeT0) / 1000, vw, vh);
    else if (this.tracker) hands = this.tracker.detect(video, now);

    if (DEV_HOOKS && this.probe.hold) hands = undefined; // frozen: keep the last gesture frame
    if (hands) {
      const frame = this.brain.update(now / 1000, hands);
      this.lastFrame = frame;
      for (const ev of frame.events) this.onEvent(ev, frame);
    }
    const frame = this.lastFrame;
    const map: ViewMap = {
      W: this.ui.stage.clientWidth || 1,
      H: this.ui.stage.clientHeight || 1,
      vw,
      vh,
      mirrored: this.camera.mirrored,
    };
    let sdt = dt;
    if (DEV_HOOKS && this.probe.hold) {
      sdt = this.probe.advance;
      this.probe.advance = 0;
    }
    if (frame) rig.update(sdt, frame, map);
    const fx = this.fx!;
    fx.update(sdt, kit.pxPerWorld);
    this.sfx?.setCharge(rig.energy, rig.mergedAmount);
    kit.trackFps(dt);
    kit.render();

    // shake + flash
    if (fx.shake > 0) {
      const a = fx.shake;
      this.ui.stage.style.transform = `translate(${(Math.random() - 0.5) * a}px, ${(Math.random() - 0.5) * a}px) scale(1.04)`;
    } else if (this.ui.stage.style.transform) {
      this.ui.stage.style.transform = '';
    }
    this.ui.flash.style.opacity = fx.flash > 0 ? String(fx.flash) : '0';

    // hints
    const present = !!frame?.slots.some((s) => s.present);
    if (present) this.noHandSince = now;
    const noHand = now - this.noHandSince > 2000;
    const launchHint = now < this.launchHintUntil && present;
    this.ui.hint.classList.toggle('is-on', noHand || launchHint);
    if (noHand !== this.hintShown || launchHint) {
      this.hintShown = noHand;
      this.ui.hint.textContent = launchHint ? 'Push toward the camera to launch' : 'Show your open palm';
    }

    // debug probe
    if (DEV_HOOKS) {
      const d = this.debug;
      d.frames++;
      if (this.tracker) {
        d.detects = this.tracker.stats.detects;
        d.hands = this.tracker.stats.hands;
        d.errors = this.tracker.stats.errors;
        d.delegate = this.tracker.stats.delegate;
      }
      const h0 = hands?.[0];
      if (h0) {
        const f = handFeatures(h0.lm);
        d.feat = { open: +f.openness.toFixed(2), pinch: +f.pinch.toFixed(2), facing: +f.facing.toFixed(2), hand: h0.handedness ?? '' };
      }
      d.quality = kit.quality;
      d.merged = frame?.merged ?? false;
      d.merge = +rig.mergedAmount.toFixed(2);
      d.orbs = rig.debugState();
      d.charge = frame?.slots.map((s) => +s.charge.toFixed(2)) ?? [];
      d.gesture = frame?.slots.map((s) => (s.present ? s.gesture : '-')) ?? [];
    }
  }
}
