// Save a PNG of the mirrored video with the effects composited on top.

import type { SceneKit } from './scene';

export function composite(video: HTMLVideoElement, kit: SceneKit, mirrored: boolean): HTMLCanvasElement {
  const gl = kit.renderer.domElement;
  const W = gl.width, H = gl.height;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const vw = video.videoWidth || W, vh = video.videoHeight || H;
  const s = Math.max(W / vw, H / vh);
  ctx.save();
  if (mirrored) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
  ctx.restore();
  // Render again right now so the WebGL drawing buffer is valid for this task, then add the
  // light on top with the same 'screen' blend the page uses.
  kit.render();
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(gl, 0, 0);
  return out;
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

/** Returns 'shared' | 'saved'. */
export async function snap(video: HTMLVideoElement, kit: SceneKit, mirrored: boolean, preferShare: boolean): Promise<'shared' | 'saved'> {
  const blob = await toBlob(composite(video, kit, mirrored));
  const name = `ki-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (preferShare && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Ki' });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
