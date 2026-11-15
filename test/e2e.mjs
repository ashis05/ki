// End-to-end test: builds the app, serves dist/ on http://127.0.0.1 (secure context),
// feeds Chromium a fake camera showing a synthetic card, and checks the full AR flow.
//
//   npm run test:e2e
//
// Env vars (see test/lib.mjs): PLAYWRIGHT_CORE, CHROMIUM_PATH, FFMPEG.
// Fixtures are generated on first run via test/make-fixtures.mjs (needs ffmpeg).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, CHROMIUM_PATH, fixtures, tmp, shots, root, serve } from './lib.mjs';

const y4m = path.join(tmp, 'camera.y4m');
if (!fs.existsSync(path.join(fixtures, 'test-card.mind')) || !fs.existsSync(y4m)) {
  execFileSync('node', [path.join(root, 'test/make-fixtures.mjs')], { stdio: 'inherit' });
}
execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
fs.mkdirSync(shots, { recursive: true });

// ?target=/fixtures/test-card.mind is the dev-only same-origin target override
const second = await serve([
  ['/', path.join(root, 'dist')],
  ['/fixtures', fixtures],
]);
const base = `http://127.0.0.1:${second.port}`;

const browser = await chromium.launch({
  executablePath: CHROMIUM_PATH,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
    '--autoplay-policy=no-user-gesture-required',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  ],
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

try {
  /* ---- 1. landing screenshots ---- */
  for (const [file, viewport, dsf] of [
    ['landing-mobile.png', { width: 390, height: 844 }, 2],
    ['landing-desktop.png', { width: 1280, height: 800 }, 1],
  ]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf });
    const page = await ctx.newPage();
    await page.goto(base + '/');
    await page.waitForSelector('#start');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(shots, file), fullPage: true });
    if (file === 'landing-mobile.png') {
      const nLinks = await page.locator('#landing .links a').count();
      const nProj = await page.locator('#landing .projects a').count();
      check('landing renders 5 links + 3 projects', nLinks === 5 && nProj === 3, `(${nLinks}/${nProj})`);
      const title = await page.title();
      check('document title', title === 'Ashis Wadhwani · AR business card');
    }
    await ctx.close();
  }

  /* ---- 2. AR flow ---- */
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    permissions: ['camera'],
  });
  await ctx.addInitScript(() => {
    window.__streams = [];
    window.__played = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); window.__streams.push(s); return s; };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.currentSrc.includes('card-loop') || this.src.includes('card-loop')) window.__played.push(this);
      return play.call(this);
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // Block real external navigation; we only care which URL was requested.
  const blocked = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { blocked.push(r.request().url()); return r.abort(); });

  await page.goto(`${base}/?target=/fixtures/test-card.mind`);
  const videoRequested = [];
  page.on('request', (r) => { if (r.url().endsWith('.mp4')) videoRequested.push(r.url()); });
  check('video not requested before Start (preload=none)', videoRequested.length === 0);
  const chunkBefore = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /session-/.test(n)));
  check('AR chunk not loaded before Start', chunkBefore.length === 0);

  await page.tap('#start');
  await page.waitForSelector('#ar:not([hidden])');
  console.log('waiting for target (software GL; can take a while)...');
  await page.waitForSelector('#ar.is-found', { timeout: 120_000 });
  check('targetFound fired (#ar.is-found)', true);
  check('scanning hint cleared on found', (await page.locator('#ar-hint').innerText()) === '');
  await page.waitForTimeout(2500); // let the stagger + fade finish

  const live = await page.evaluate(() => window.__streams.filter((s) => s.getTracks().some((t) => t.readyState === 'live')).length);
  check('camera stream live', live >= 1);

  const vid = await page.evaluate(() => {
    const v = window.__played[0];
    return v ? { paused: v.paused, muted: v.muted, loop: v.loop, t: v.currentTime, w: v.videoWidth, ready: v.readyState } : null;
  });
  check('mp4 playing (muted, loop, decoded)', !!vid && !vid.paused && vid.muted && vid.loop && vid.w > 0 && vid.ready >= 2, JSON.stringify(vid));

  const panels = await page.evaluate(() =>
    [...document.querySelectorAll('.ar-anchor')].map((el) => ({
      panel: el.dataset.panel,
      cls: el.classList.contains('is-in'),
      vis: getComputedStyle(el).visibility,
      opacity: getComputedStyle(el.firstElementChild).opacity,
    })),
  );
  check('3 CSS3D panels visible + animated in', panels.length === 3 && panels.every((p) => p.cls && p.vis === 'visible' && Number(p.opacity) > 0.95), JSON.stringify(panels));

  // elementFromPoint at the centre of every anchored link/tile
  const hit = await page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('.ar-anchor a')) {
      const r = a.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const inView = cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight;
      const el = document.elementFromPoint(cx, cy);
      out.push({ id: a.dataset.link ?? a.dataset.project, inView, ok: !!el && a.contains(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  });
  console.log('   hit-test:', JSON.stringify(hit));
  const visibleHits = hit.filter((h) => h.inView);
  check('anchored links hit-testable via elementFromPoint', visibleHits.length >= 5 && visibleHits.every((h) => h.ok), `${visibleHits.filter((h) => h.ok).length}/${visibleHits.length} in view`);

  await page.screenshot({ path: path.join(shots, 'ar-view.png') });

  // Real tap on the GitHub chip inside the CSS3D panel -> opens a new tab
  const gh = page.locator('.ar-anchor a[data-link="github"]');
  const popupP = ctx.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
  const box = await gh.boundingBox();
  if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const popup = await popupP;
  check('tapping the GitHub chip in 3D opens github.com/ashis05', blocked.some((u) => u.startsWith('https://github.com/ashis05')), blocked.join(' '));
  if (popup) await popup.close().catch(() => undefined);

  // Bottom sheet
  await page.tap('.btn--sheet');
  check('Links sheet opens', await page.locator('#ar-sheet').isVisible());
  await page.tap('.btn--sheet');

  /* ---- visibilitychange: camera released + resumed ---- */
  const setHidden = (hidden) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await page.waitForTimeout(1000);
  const liveHidden = await page.evaluate(() => window.__streams.filter((s) => s.getTracks().some((t) => t.readyState === 'live')).length);
  check('camera released while page hidden', liveHidden === 0);
  await setHidden(false);
  await page.waitForSelector('#ar.is-found', { timeout: 120_000 });
  check('tracking resumes after page visible again', true);

  /* ---- close ---- */
  await page.tap('.ar-close');
  await page.waitForSelector('#ar', { state: 'hidden' });
  await page.waitForTimeout(500);
  const liveClosed = await page.evaluate(() => window.__streams.filter((s) => s.getTracks().some((t) => t.readyState === 'live')).length);
  check('camera released after closing AR', liveClosed === 0);

  check('no page errors / console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  second.server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
