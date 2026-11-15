// Builds the synthetic test card, compiles it to a MindAR .mind target and renders a
// fake-camera .y4m video of it. Outputs:
//   test/fixtures/test-card.png   (1050x600 feature-rich image)
//   test/fixtures/test-card.mind  (compiled with MindAR's own Compiler, in the browser)
//   test/.tmp/camera.y4m          (gitignored; large)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, CHROMIUM_PATH, FFMPEG, fixtures, tmp, root, serve } from './lib.mjs';

fs.mkdirSync(fixtures, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });

fs.writeFileSync(path.join(tmp, 'blank.html'), '<!doctype html><canvas id="c" width="1050" height="600"></canvas>');
// Same-origin + http://127.0.0.1 (a secure context) so tfjs/workers behave like production.
const { server, port } = await serve([
  ['/', tmp],
  ['/mindar', path.join(root, 'node_modules/mind-ar/dist')],
]);
const origin = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({
  executablePath: CHROMIUM_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${origin}/blank.html`);

// 1. Draw a deterministic, texture-rich card.
const png = await page.evaluate(() => {
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = '#e9e0d0';
  g.fillRect(0, 0, 1050, 600);
  for (let i = 0; i < 900; i++) {
    const s = 12 + rnd() * rnd() * 160;
    const x = rnd() * 1050, y = rnd() * 600;
    g.fillStyle = `hsla(${Math.floor(rnd() * 360)},${30 + rnd() * 60}%,${15 + rnd() * 65}%,${0.35 + rnd() * 0.55})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * s * 2, y + (rnd() - 0.5) * s * 2);
    g.lineTo(x + (rnd() - 0.5) * s * 2, y + (rnd() - 0.5) * s * 2);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = 'rgba(29,25,21,0.8)';
  for (let r = 20; r < 300; r += 22) { g.lineWidth = 1 + (r % 3); g.beginPath(); g.arc(790, 300, r, 0, Math.PI * 2); g.stroke(); }
  for (let gy = 0; gy < 12; gy++) for (let gx = 0; gx < 12; gx++) {
    if (rnd() > 0.5) { g.fillStyle = '#1d1915'; g.fillRect(40 + gx * 26, 360 + gy * 18, 22, 14); }
  }
  g.fillStyle = '#1d1915';
  g.font = '700 92px monospace'; g.fillText('SYNTHETIC', 40, 120);
  g.font = '600 64px serif'; g.fillText('TEST CARD', 60, 200);
  g.font = '500 28px sans-serif'; g.fillText('mind-ar e2e fixture - not the real card', 40, 250);
  g.font = '400 20px monospace';
  for (let i = 0; i < 4; i++) g.fillText(`0x${(rnd() * 1e9 >>> 0).toString(16)} AW-${i} ~~ // {}`, 360, 340 + i * 26);
  const img = g.getImageData(0, 0, 1050, 600);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 36;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
});
fs.writeFileSync(path.join(fixtures, 'test-card.png'), Buffer.from(png.split(',')[1], 'base64'));

// 2. Compile with MindAR's Compiler.
const b64 = await page.evaluate(async ({ png }) => {
  const { Compiler } = await import(`/mindar/mindar-image.prod.js`);
  const img = new Image();
  img.src = png;
  await img.decode();
  const compiler = new Compiler();
  await compiler.compileImageTargets([img], (p) => { if (Math.round(p) % 25 === 0) console.log('compile', Math.round(p) + '%'); });
  const buf = await compiler.exportData();
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}, { png });
const mind = Buffer.from(b64, 'base64');
fs.writeFileSync(path.join(fixtures, 'test-card.mind'), mind);
console.log(`test-card.mind: ${mind.length} bytes`);
await browser.close();
server.close();

// 3. Fake camera: portrait 360x780 grey scene (same aspect as the 390x844 test viewport; card ~84% of width), the card drifting/rotating gently with a little perspective.
const out = path.join(tmp, 'camera.y4m');
execFileSync(FFMPEG, [
  '-v', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x5d6066:s=360x780:r=15:d=8',
  '-loop', '1', '-framerate', '15', '-t', '8', '-i', path.join(fixtures, 'test-card.png'),
  '-filter_complex',
  '[1:v]scale=300:-1,format=rgba,rotate=0.06*sin(2*PI*t/4):c=none:ow=iw+40:oh=ih+40[card];' +
  '[0:v][card]overlay=x=(W-w)/2+10*sin(2*PI*t/8):y=(H-h)/2+10*cos(2*PI*t/8):shortest=1,format=yuv420p',
  '-pix_fmt', 'yuv420p', out,
], { stdio: 'inherit' });
console.log('camera.y4m:', (fs.statSync(out).size / 1e6).toFixed(1), 'MB');
