// HandLandmarker wrapper: self-hosted wasm + model, GPU delegate with CPU fallback.
// Loaded lazily; nothing here runs on the landing page.

import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { ExperienceError } from './camera';
import type { RawHand } from './gestures';

const BASE = import.meta.env.BASE_URL;
export const WASM_PATH = `${BASE}mediapipe/wasm`;
export const MODEL_PATH = `${BASE}models/hand_landmarker.task`;

async function fetchWithProgress(url: string, onProgress: (frac: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export interface TrackerStats {
  detects: number;
  hands: number;
  errors: number;
  delegate: 'GPU' | 'CPU' | '';
}

export class HandTracker {
  readonly stats: TrackerStats = { detects: 0, hands: 0, errors: 0, delegate: '' };
  private lastTs = 0;
  private lastVideoTime = -1;

  private constructor(private lm: HandLandmarker) {}

  static async create(onStatus: (text: string) => void): Promise<HandTracker> {
    try {
      onStatus('Loading hand tracker…');
      const [{ FilesetResolver, HandLandmarker }, model] = await Promise.all([
        import('@mediapipe/tasks-vision'),
        fetchWithProgress(MODEL_PATH, (f) => onStatus(`Loading hand model… ${Math.round(f * 100)}%`)),
      ]);
      onStatus('Starting hand tracker…');
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      const make = (delegate: 'GPU' | 'CPU') =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: model.slice(), delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      let delegate: 'GPU' | 'CPU' = 'GPU';
      let lm: HandLandmarker;
      try {
        lm = await make('GPU');
      } catch {
        delegate = 'CPU';
        lm = await make('CPU');
      }
      const t = new HandTracker(lm);
      t.stats.delegate = delegate;
      return t;
    } catch (err) {
      throw new ExperienceError('model', err instanceof Error ? err.message : String(err));
    }
  }

  /** Runs detection if the video has a new frame. Returns undefined when there is nothing new. */
  detect(video: HTMLVideoElement, nowMs: number): RawHand[] | undefined {
    if (video.readyState < 2 || video.videoWidth === 0) return undefined;
    if (video.currentTime === this.lastVideoTime) return undefined;
    this.lastVideoTime = video.currentTime;
    const ts = Math.max(nowMs, this.lastTs + 1);
    this.lastTs = ts;
    try {
      const res = this.lm.detectForVideo(video, ts);
      this.stats.detects++;
      const vw = video.videoWidth, vh = video.videoHeight;
      const hands = res.landmarks.map((pts, i) => {
        const h = res.handedness?.[i]?.[0]?.categoryName;
        return { lm: pts.map((p) => ({ x: p.x * vw, y: p.y * vh, z: p.z * vw })), ...(h ? { handedness: h } : {}) };
      });
      this.stats.hands = hands.length;
      return hands;
    } catch (err) {
      this.stats.errors++;
      console.error('hand detection failed', err);
      return undefined;
    }
  }

  close(): void {
    this.lm.close();
  }
}
