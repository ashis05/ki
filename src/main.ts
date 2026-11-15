// Landing + lifecycle. Everything heavy (three.js, MediaPipe, the model) lives in the
// lazily imported ./experience chunk and is only fetched after Start.

import './styles.css';
import type { Experience, ErrorKind } from './experience';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const startBtn = $<HTMLButtonElement>('start');
const note = $('support-note');
const exp = $('exp');
const stage = $('stage');
const video = $<HTMLVideoElement>('cam');
const hint = $('hint');
const flash = $('flash');
const stateBox = $('state');
const toast = $('toast');
const closeBtn = $<HTMLButtonElement>('close');
const muteBtn = $<HTMLButtonElement>('mute');
const flipBtn = $<HTMLButtonElement>('flip');
const snapBtn = $<HTMLButtonElement>('snap');
const paletteBtn = $<HTMLButtonElement>('palette');
const paletteDot = $('palette-dot');

if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
  startBtn.disabled = true;
  note.textContent = window.isSecureContext
    ? 'This browser cannot open a camera. Try a recent Chrome, Edge, Safari or Firefox.'
    : 'Camera access needs a secure (https) connection.';
}

/* ---------- state box ---------- */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function showStatus(text: string) {
  stateBox.hidden = text === '';
  if (!text) return;
  const p = el('p', '', text);
  p.setAttribute('role', 'status');
  stateBox.replaceChildren(el('div', 'spinner'), p);
  stateBox.dataset['kind'] = 'loading';
}

const ERRORS: Record<string, { title: string; body: string; retry: boolean }> = {
  denied: {
    title: 'Camera access is off',
    body: 'Ki needs your camera to see your hand. Allow camera access for this site: in Chrome tap the lock icon by the address, then Permissions, then Camera. On iPhone open Settings, Safari, Camera and choose Ask or Allow. Then reload this page.',
    retry: false,
  },
  insecure: { title: 'Secure connection needed', body: 'Browsers only allow the camera on https pages.', retry: false },
  unsupported: { title: 'Not supported here', body: 'This browser cannot open a camera. Try a recent Chrome, Edge, Safari or Firefox.', retry: false },
  webgl: { title: 'Graphics not available', body: 'Ki needs WebGL 2 and WebAssembly. Try another browser or turn on hardware acceleration.', retry: false },
  'no-camera': { title: 'No camera found', body: 'This device has no usable camera. Open Ki on a phone or a laptop with a webcam.', retry: false },
  busy: { title: 'Camera is busy', body: 'Another app is using the camera. Close it and try again.', retry: true },
  model: { title: 'Could not load the hand tracker', body: 'The tracking files failed to load. Check your connection and try again.', retry: true },
  unknown: { title: 'Something went wrong', body: 'The camera or the tracker could not be started.', retry: true },
};

function showError(kind: string) {
  const c = ERRORS[kind] ?? ERRORS['unknown']!;
  const h = el('h2', 'exp__state-title', c.title);
  h.tabIndex = -1;
  const actions = el('div', 'exp__state-actions');
  if (c.retry) {
    const retry = el('button', 'btn', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => void open());
    actions.append(retry);
  }
  const back = el('button', 'btn btn--ghost', 'Back');
  back.type = 'button';
  back.addEventListener('click', () => void close());
  actions.append(back);
  stateBox.replaceChildren(h, el('p', '', c.body), actions);
  stateBox.dataset['kind'] = 'error';
  stateBox.hidden = false;
  h.focus();
}

let toastTimer = 0;
function showToast(text: string) {
  toast.textContent = text;
  toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-on'), 2200);
}

function setPalette(name: string, hex: string) {
  paletteDot.style.background = hex;
  paletteDot.style.boxShadow = `0 0 12px ${hex}`;
  paletteBtn.setAttribute('aria-label', `Colour: ${name}. Pinch or tap to change`);
}

function setMuted(m: boolean) {
  muteBtn.setAttribute('aria-pressed', String(m));
  muteBtn.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
}

/* ---------- lifecycle ---------- */

let experience: Experience | null = null;
let audioCtx: AudioContext | null = null;
let isOpen = false;
let suspended = false;

function createAudio(): AudioContext | null {
  // Must happen inside the click handler: browsers only allow audio after a gesture.
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = new AC();
    void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

async function open() {
  isOpen = true;
  suspended = false;
  exp.hidden = false;
  document.documentElement.classList.add('exp-open');
  showStatus('Loading…');
  audioCtx ??= createAudio();
  try {
    const mod = await import('./experience');
    if (!isOpen) return;
    experience ??= new mod.Experience(
      {
        stage,
        video,
        hint,
        flash,
        status: showStatus,
        palette: setPalette,
        canFlip: (v) => (flipBtn.hidden = !v),
        toast: showToast,
      },
      audioCtx,
    );
    await experience.start();
    if (!isOpen) {
      experience.stop();
      return;
    }
    setMuted(experience.muted);
    muteBtn.hidden = !experience.hasAudio;
    closeBtn.focus();
  } catch (err) {
    if (!isOpen) return;
    const kind = (err as { kind?: ErrorKind } | null)?.kind;
    showError(kind ?? 'model');
  }
}

async function close() {
  isOpen = false;
  exp.hidden = true;
  document.documentElement.classList.remove('exp-open');
  stateBox.hidden = true;
  experience?.stop();
  startBtn.focus();
}

startBtn.addEventListener('click', () => void open());
closeBtn.addEventListener('click', () => void close());
muteBtn.addEventListener('click', () => experience && setMuted(experience.toggleMute()));
flipBtn.addEventListener('click', () => void experience?.flip());
snapBtn.addEventListener('click', () => void experience?.snap());
paletteBtn.addEventListener('click', () => experience?.cyclePalette());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isOpen) void close();
});

// Release the camera while the tab is hidden; resume when it is back.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (isOpen && experience?.isRunning) {
      suspended = true;
      experience.pause();
    }
  } else if (suspended && isOpen) {
    suspended = false;
    showStatus('Resuming…');
    experience?.resume().then(
      () => showStatus(''),
      (err: unknown) => showError((err as { kind?: string } | null)?.kind ?? 'unknown'),
    );
  }
});
