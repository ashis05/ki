import './styles.css';
import { person } from './content';
import { h, linkButtons, projectTiles } from './dom';
import { cameraSupport, ArError } from './ar/errors';
import type { ArSession } from './ar/session';

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

/* ---------- landing ---------- */

const support = cameraSupport();

const startBtn = h('button', { class: 'btn btn--primary', type: 'button', id: 'start' }, 'Start camera');
const note = h('p', { class: 'note', id: 'support-note', role: 'status' });
if (!support.ok) {
  startBtn.setAttribute('disabled', '');
  note.textContent = `${support.message} The links below work everywhere.`;
} else {
  note.textContent = 'Your camera is only used on this device to find the card. Nothing is recorded or uploaded.';
}

const landing = h(
  'div',
  { class: 'landing', id: 'landing' },
  h(
    'header',
    { class: 'hero' },
    h('p', { class: 'eyebrow' }, 'AR business card'),
    h('h1', { class: 'hero__name' }, person.name),
    h('p', { class: 'hero__role' }, `${person.role} · ${person.place}`),
    h('p', { class: 'hero__lede' }, person.tagline),
    h('div', { class: 'hero__actions' }, startBtn),
    note,
  ),
  h(
    'main',
    { class: 'sheet-paper' },
    h(
      'section',
      { class: 'block', 'aria-labelledby': 'links-h' },
      h('h2', { id: 'links-h', class: 'block__title' }, 'Find me'),
      h('div', { class: 'links' }, ...linkButtons(true)),
    ),
    h(
      'section',
      { class: 'block', 'aria-labelledby': 'proj-h' },
      h('h2', { id: 'proj-h', class: 'block__title' }, 'Selected projects'),
      h('div', { class: 'projects' }, ...projectTiles()),
    ),
    h('footer', { class: 'foot' }, `${person.name} · ${person.place}`),
  ),
);

/* ---------- AR overlay ---------- */

const stage = h('div', { class: 'ar-stage', id: 'ar-stage' });
const hint = h('p', { class: 'ar-hint', id: 'ar-hint', role: 'status' }, 'Fit the card in the frame');
const frame = h('div', { class: 'ar-frame', 'aria-hidden': 'true' });
const closeBtn = h('button', { class: 'ar-close', type: 'button', 'aria-label': 'Close camera' }, '×');
const sheetBtn = h(
  'button',
  { class: 'btn btn--sheet', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ar-sheet' },
  'Links',
);
const sheet = h(
  'div',
  { class: 'ar-sheet', id: 'ar-sheet', role: 'region', 'aria-label': 'Links', hidden: '' },
  h('div', { class: 'links links--sheet' }, ...linkButtons()),
  h('div', { class: 'projects projects--sheet' }, ...projectTiles()),
);
const stateBox = h('div', { class: 'ar-state', id: 'ar-state', hidden: '' });

const overlay = h(
  'div',
  { class: 'ar', id: 'ar', hidden: '', 'aria-label': 'Augmented reality view' },
  stage,
  frame,
  hint,
  closeBtn,
  sheet,
  sheetBtn,
  stateBox,
);

app.append(landing, overlay);

/* ---------- state ---------- */

let session: ArSession | null = null;
let sessionPromise: Promise<ArSession> | null = null;
let arOpen = false;

function setSheet(open: boolean) {
  sheet.hidden = !open;
  sheetBtn.setAttribute('aria-expanded', String(open));
  sheetBtn.textContent = open ? 'Hide links' : 'Links';
}

function showLoading(text: string) {
  stateBox.hidden = text === '';
  if (text === '') return;
  stateBox.replaceChildren(h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { role: 'status' }, text));
  stateBox.dataset.kind = 'loading';
}

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  denied: {
    title: 'Camera access is off',
    body: 'To see the card come alive, allow camera access for this site. In Chrome or Android: tap the lock icon next to the address, then Permissions, then Camera. On iPhone: Settings, Safari, Camera, then choose Ask or Allow. Reload this page afterwards.',
  },
  insecure: { title: 'Secure connection needed', body: 'Browsers only allow the camera on https pages.' },
  unsupported: { title: 'Camera not available', body: 'This browser cannot open a camera. Try Safari or Chrome on your phone.' },
  'no-camera': { title: 'No camera found', body: 'This device has no usable camera. Open this page on your phone instead.' },
  busy: { title: 'Camera is busy', body: 'Another app is using the camera. Close it and try again.' },
  target: { title: 'Could not start AR', body: 'The tracking data failed to load. Check your connection and try again.' },
  unknown: { title: 'Something went wrong', body: 'The camera or tracker could not be started.' },
};

function showError(kind: string) {
  const copy = ERROR_COPY[kind] ?? ERROR_COPY['unknown'];
  if (!copy) return;
  const retry = h('button', { class: 'btn btn--primary', type: 'button' }, 'Try again');
  const back = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Back to links');
  retry.addEventListener('click', () => void openAr());
  back.addEventListener('click', () => void closeAr());
  stateBox.replaceChildren(
    h('h2', { class: 'ar-state__title', tabindex: '-1' }, copy.title),
    h('p', {}, copy.body),
    h('div', { class: 'ar-state__actions' }, kind === 'denied' || kind === 'no-camera' ? back : retry, kind === 'denied' || kind === 'no-camera' ? null : back),
  );
  stateBox.dataset.kind = 'error';
  stateBox.hidden = false;
  stateBox.querySelector<HTMLElement>('h2')?.focus();
}

function setFound(found: boolean) {
  overlay.classList.toggle('is-found', found);
  hint.textContent = found ? '' : 'Fit the card in the frame';
}

async function getSession(): Promise<ArSession> {
  if (session) return session;
  sessionPromise ??= import('./ar/session').then(({ ArSession }) => {
    session = new ArSession(stage, {
      onStage: showLoading,
      onFound: () => setFound(true),
      onLost: () => setFound(false),
      onTargetRatio: (r) => overlay.style.setProperty('--card-ratio', String(1 / r)),
    });
    return session;
  });
  return sessionPromise;
}

async function openAr() {
  arOpen = true;
  overlay.hidden = false;
  document.documentElement.classList.add('ar-open');
  setFound(false);
  setSheet(false);
  showLoading('Loading AR…');
  try {
    const s = await getSession();
    if (!arOpen) return;
    await s.start();
    if (arOpen) closeBtn.focus();
  } catch (err) {
    if (!arOpen) return;
    // Failed chunk import (offline) lands here as a plain Error.
    showError(err instanceof ArError ? err.kind : 'target');
    sessionPromise = session ? sessionPromise : null;
  }
}

async function closeAr() {
  arOpen = false;
  overlay.hidden = true;
  document.documentElement.classList.remove('ar-open');
  stateBox.hidden = true;
  setSheet(false);
  await session?.stop();
  startBtn.focus();
}

startBtn.addEventListener('click', () => void openAr());
closeBtn.addEventListener('click', () => void closeAr());
sheetBtn.addEventListener('click', () => setSheet(sheet.hasAttribute('hidden')));
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !arOpen) return;
  if (!sheet.hasAttribute('hidden')) setSheet(false);
  else void closeAr();
});

// Release the camera while the tab is hidden; resume when it comes back.
let suspended = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (arOpen && session?.isActive) {
      suspended = true;
      void session.stop();
    }
  } else if (suspended) {
    suspended = false;
    if (arOpen) void openAr();
  }
});
