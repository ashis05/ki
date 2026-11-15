export type ArErrorKind = 'insecure' | 'unsupported' | 'denied' | 'no-camera' | 'busy' | 'target' | 'unknown';

export class ArError extends Error {
  constructor(
    public readonly kind: ArErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** True when the browser can give us a camera at all. */
export function cameraSupport(): { ok: true } | { ok: false; kind: ArErrorKind; message: string } {
  if (!window.isSecureContext) {
    return {
      ok: false,
      kind: 'insecure',
      message: 'The camera only works on secure (https) pages. Open this page over https to use AR.',
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      kind: 'unsupported',
      message: 'This browser cannot access a camera. Try the latest Safari, Chrome or Firefox on your phone.',
    };
  }
  return { ok: true };
}

/**
 * MindAR swallows getUserMedia errors, so we probe once ourselves to tell
 * "denied" from "no camera" from "in use". The probe stream is closed straight away.
 */
export async function probeCamera(): Promise<void> {
  const support = cameraSupport();
  if (!support.ok) throw new ArError(support.kind, support.message);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
    stream.getTracks().forEach((t) => t.stop());
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new ArError('denied', 'Camera access was blocked.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new ArError('no-camera', 'No camera was found on this device.');
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      throw new ArError('busy', 'The camera is in use by another app. Close it and try again.');
    }
    throw new ArError('unknown', 'The camera could not be started.');
  }
}
