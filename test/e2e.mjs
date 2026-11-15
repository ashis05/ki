// End-to-end test for Ki. Needs Chromium, playwright-core and ffmpeg (see test/lib.mjs).
//
//   npm run test:e2e
//
// What it does
//  1. Builds the production bundle (dist/) and a non-production "e2e" bundle (dist-e2e/, MODE=e2e).
//  2. Landing (production bundle): loads with no three / MediaPipe / model requests.
//  3. Fake camera (a dark synthetic video, no people): Start -> the real HandLandmarker loads
//     from self-hosted files and runs on frames without errors.
//  4. Synthetic-hand mode (`?fake=` is honoured ONLY by non-production builds): screenshots of
//     charging, idle, fist, pinch, two-hand merge and a launch burst. These go to docs/readme.
//  5. Real-hand check: an openly licensed open-palm photo is turned into the fake camera and the
//     real HandLandmarker must detect it and the orb must charge. The photo is downloaded into
//     test/.tmp (gitignored) and never committed.
//
// Photo: "Left-palm.jpg" by 些細な日常 (nagahitoyuki.com), CC BY-SA 4.0
//   https://commons.wikimedia.org/wiki/File:Left-palm.jpg
//   file: https://upload.wikimedia.org/wikipedia/commons/d/dc/Left-palm.jpg
//
// Why `?fake=` is safe: it is gated on `import.meta.env.MODE !== 'production'`, which Vite
// replaces with a literal at build time, so production bundles contain neither the synthetic
// hand code nor the window.__ki probe (step 2 asserts this). Even where present it only injects
// made-up landmarks; it cannot read or expose camera data.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, CHROMIUM_PATH, FFMPEG, tmp, shots, root, serve } from './lib.mjs';

fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(shots, { recursive: true });

/* ---------- fixtures ---------- */
const darkY4m = path.join(tmp, 'dark.y4m');
if (!fs.existsSync(darkY4m)) {
  // neutral dark gradient, portrait, no people
  execFileSync(FFMPEG, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    'gradients=s=360x640:c0=0x0b0f1a:c1=0x252e44:x0=0:y0=0:x1=360:y1=640:d=4:speed=0.02:rate=30',
    '-t', '4', '-pix_fmt', 'yuv420p', darkY4m]);
}
const photo = path.join(tmp, 'left-palm.jpg');
const palmY4m = path.join(tmp, 'palm.y4m');
let havePhoto = fs.existsSync(photo);
if (!havePhoto) {
  try {
    const res = await fetch('https://upload.wikimedia.org/wikipedia/commons/d/dc/Left-palm.jpg', { headers: { 'user-agent': 'ki-e2e/1.0' } });
    if (res.ok) { fs.writeFileSync(photo, Buffer.from(await res.arrayBuffer())); havePhoto = true; }
  } catch { /* offline: real-hand check is skipped */ }
}
if (havePhoto && !fs.existsSync(palmY4m)) {
  execFileSync(FFMPEG, ['-loglevel', 'error', '-y', '-loop', '1', '-i', photo, '-vf', 'scale=640:360,format=yuv420p', '-r', '30', '-t', '3', palmY4m]);
}

/* ---------- builds ---------- */
execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
execFileSync('npx', ['vite', 'build', '--mode', 'e2e', '--outDir', 'dist-e2e', '--emptyOutDir'], { cwd: root, stdio: 'inherit' });

const prod = await serve([['/', path.join(root, 'dist')]]);
const e2e = await serve([['/', path.join(root, 'dist-e2e')]]);
const prodBase = `http://127.0.0.1:${prod.port}`;
const e2eBase = `http://127.0.0.1:${e2e.port}`;

const launch = (y4m) => chromium.launch({
  executablePath: CHROMIUM_PATH,
  args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'], isMobile: false };
const dbg = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__ki?.debug ?? null))).catch(() => null);
// Polls from node (not inside the page) so a busy page cannot starve the timeout.
const waitDbg = async (page, expr, timeout = 60000) => {
  const t0 = Date.now();
  const fn = new Function('d', `return !!d && (${expr});`);
  for (;;) {
    const d = await Promise.race([dbg(page), sleep(20000).then(() => null)]);
    if (d && fn(d)) return d;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${expr}; last=${JSON.stringify(d)}`);
    await sleep(60);
  }
};

// Freeze animation time (non-production probe), letting `advance` seconds through once.
const freeze = async (page, advance) => {
  await page.evaluate((a) => { window.__ki.hold = true; window.__ki.advance = a; }, advance);
  await sleep(2500); // a few (slow, software-rendered) frames
};
const unfreeze = (page) => page.evaluate(() => { window.__ki.hold = false; });

let browser;
try {
  /* ---- 1. landing (production bundle) ---- */
  browser = await launch(darkY4m);
  {
    const ctx = await browser.newContext({ ...phone, permissions: [] });
    const page = await ctx.newPage();
    const reqs = [];
    page.on('request', (r) => reqs.push(new URL(r.url()).pathname));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(prodBase + '/');
    await page.waitForSelector('#start');
    await page.evaluate(() => document.fonts.ready);
    await sleep(500);
    const heavy = reqs.filter((u) => /three|vision_bundle|experience|\.task|\.wasm|mediapipe|models/.test(u));
    check('landing loads without three / MediaPipe / model', heavy.length === 0, heavy.join(','));
    const entries = await page.evaluate(() => [
      ...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource'),
    ].map((e) => e.encodedBodySize || 0));
    const bytes = entries.reduce((a, b) => a + b, 0);
    check('landing is small (< 250 KB incl. fonts)', bytes < 250_000, `${(bytes / 1024).toFixed(0)} KB over ${reqs.length} requests`);
    check('landing title', (await page.title()) === 'Ki · hand-tracked energy orb', await page.title());
    check('landing has Start, legend and footer links',
      (await page.locator('#start').count()) === 1 && (await page.locator('.legend li').count()) === 5 &&
      (await page.locator('a[href="https://www.ashiswadhwani.in"]').count()) === 1 &&
      (await page.locator('a[href="https://github.com/ashis05"]').count()) === 1);
    const prodJs = fs.readdirSync(path.join(root, 'dist/assets')).filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(root, 'dist/assets', f), 'utf8')).join('\n');
    check('production bundle has no ?fake / __ki hooks', !/__ki|"fake"|FAKE_MODES/.test(prodJs));
    check('no page errors on landing', errors.length === 0, errors.join('|'));
    await page.screenshot({ path: path.join(shots, 'landing.png') });
    await ctx.close();
  }

  /* ---- 2. real model on a hand-less fake camera ---- */
  console.log('step 2: real model');
  {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const errors = [];
    const reqs = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (r) => reqs.push(r.url()));
    await page.goto(e2eBase + '/?q=0');
    await page.click('#start');
    await waitDbg(page, 'd.detects > 8', 240000);
    const d = await dbg(page);
    check('Start -> HandLandmarker runs on camera frames', d.detects > 8 && d.errors === 0, `detects=${d.detects} delegate=${d.delegate} frames=${d.frames}`);
    check('no hand in a hand-less video, no orb', d.hands === 0 && d.charge.every((c) => c === 0));
    check('wasm + model are self-hosted (same origin only)',
      reqs.some((u) => u.endsWith('hand_landmarker.task')) && reqs.some((u) => u.endsWith('vision_wasm_internal.wasm')) &&
      reqs.filter((u) => /^https?:/.test(u)).every((u) => u.startsWith(e2eBase)));
    await sleep(2300);
    check('hint appears with no hand', await page.locator('#hint.is-on').count() === 1, await page.locator('#hint').innerText());
    check('no console/page errors', errors.length === 0, errors.slice(0, 3).join('|'));
    await page.click('#close');
    await sleep(300);
    check('close stops the camera tracks', await page.evaluate(() => { const v = document.getElementById('cam'); return !v.srcObject; }));
    await ctx.close();
  }

  /* ---- 3. synthetic hands: gestures + screenshots ---- */
  const synth = async (mode, fn) => {
    console.log(`step 3: fake=${mode}`);
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${e2eBase}/?fake=${mode}&q=2`);
    await page.click('#start');
    await waitDbg(page, 'd.frames > 3', 90000);
    await fn(page);
    check(`fake=${mode}: no page errors`, errors.length === 0, errors.join('|'));
    await ctx.close();
  };

  await synth('open', async (page) => {
    await waitDbg(page, 'd.charge[0] > 0.35 && d.charge[0] < 0.8 && d.gesture[0] === "open"');
    await page.screenshot({ path: path.join(tmp, 'charging.png') });
    await waitDbg(page, 'd.charge[0] >= 1');
    check('open palm charges the orb to full', true);
    await sleep(1500);
    await page.screenshot({ path: path.join(shots, 'orb.png') });
  });

  await synth('fist', async (page) => {
    await waitDbg(page, 'd.counts.charged >= 1');
    await waitDbg(page, 'd.counts.implode >= 1', 30000);
    check('fist implodes a charged orb', true);
    await waitDbg(page, 'd.charge[0] === 0');
  });

  await synth('pinch', async (page) => {
    await waitDbg(page, 'd.counts.pinch >= 1', 30000);
    const d = await dbg(page);
    check('pinch cycles the palette', d.palette === 'crimson', d.palette);
    const label = await page.getAttribute('#palette', 'aria-label');
    check('palette dot reflects the colour', /crimson/.test(label), label);
    await sleep(700);
    await page.screenshot({ path: path.join(tmp, 'pinch-crimson.png') });
  });

  await synth('two', async (page) => {
    await waitDbg(page, 'd.merged === true', 60000);
    await waitDbg(page, 'd.charge[0] >= 1 && d.charge[1] >= 1 && d.merge > 0.9', 30000);
    check('two open hands close together merge', true);
    await freeze(page, 0.35); // let the springs settle, then capture
    await page.screenshot({ path: path.join(shots, 'merge.png') });
    await unfreeze(page);
    await waitDbg(page, 'd.merged === false && d.counts.split >= 1', 60000);
    check('pulling apart splits them', true);
  });

  await synth('push', async (page) => {
    await waitDbg(page, 'd.counts.launch >= 1', 90000);
    check('a push launches the orb', true);
    await waitDbg(page, 'd.counts.burst >= 1', 20000);
    await freeze(page, 0.12); // freeze animation time shortly after the burst
    await page.screenshot({ path: path.join(shots, 'burst.png') });
    await unfreeze(page);
    await waitDbg(page, 'd.charge[0] > 0.5', 30000);
    check('the orb recharges after the burst', true);
  });
  await browser.close();

  /* ---- 4. real hand (photo as the camera) ---- */
  if (havePhoto) {
    browser = await launch(palmY4m);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, permissions: ['camera'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(e2eBase + '/?q=1');
    await page.click('#start');
    let ok = true;
    try { await waitDbg(page, 'd.hands >= 1 && d.charge[0] > 0.5', 90000); } catch { ok = false; }
    const d = await dbg(page);
    console.log('real-hand probe:', JSON.stringify({ hands: d.hands, gesture: d.gesture, charge: d.charge, feat: d.feat, delegate: d.delegate, detects: d.detects }));
    check('real photo: HandLandmarker detects the hand and the orb appears', ok && d.gesture[0] === 'open', `gesture=${d.gesture} charge=${d.charge}`);
    await page.screenshot({ path: path.join(tmp, 'real-hand.png') });
    check('real photo: no page errors', errors.length === 0, errors.join('|'));
    await ctx.close();
  } else {
    console.log('SKIP  real-hand check (photo unavailable)');
  }
} catch (err) {
  console.error(err);
  check('e2e ran to completion', false, String(err).split('\n')[0]);
} finally {
  await browser?.close().catch(() => {});
  prod.server.close();
  e2e.server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
