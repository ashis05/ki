// Camera access. Front camera by default, optional flip, typed errors for the UI.

export type Facing = 'user' | 'environment';
export type ErrorKind = 'denied' | 'insecure' | 'unsupported' | 'no-camera' | 'busy' | 'model' | 'webgl' | 'unknown';

export class ExperienceError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
  }
}

export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function support(): { ok: true } | { ok: false; kind: ErrorKind } {
  if (!window.isSecureContext) return { ok: false, kind: 'insecure' };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, kind: 'unsupported' };
  if (typeof WebAssembly !== 'object' || !webgl2Available()) return { ok: false, kind: 'webgl' };
  return { ok: true };
}

function mapError(err: unknown): ExperienceError {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return new ExperienceError('denied');
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return new ExperienceError('no-camera');
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return new ExperienceError('busy');
  return new ExperienceError('unknown', err instanceof Error ? err.message : String(err));
}

export class Camera {
  private stream: MediaStream | null = null;
  facing: Facing = 'user';
  multiple = false;

  constructor(readonly video: HTMLVideoElement) {}

  get active(): boolean {
    return this.stream !== null;
  }

  /** True when the picture should be shown mirrored (selfie view). */
  get mirrored(): boolean {
    const s = this.stream?.getVideoTracks()[0]?.getSettings();
    return s?.facingMode ? s.facingMode !== 'environment' : this.facing === 'user';
  }

  async start(facing: Facing = this.facing): Promise<void> {
    this.stop();
    this.facing = facing;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (err) {
      throw mapError(err);
    }
    this.stream = stream;
    const v = this.video;
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    try {
      await v.play();
    } catch (err) {
      this.stop();
      throw mapError(err);
    }
    if (v.videoWidth === 0) {
      await new Promise<void>((res) => v.addEventListener('loadeddata', () => res(), { once: true }));
    }
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      this.multiple = devs.filter((d) => d.kind === 'videoinput').length > 1;
    } catch {
      this.multiple = false;
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
