// Shared helpers for the e2e scripts.
//
// Environment variables (all optional, sensible defaults for the author's machine):
//   PLAYWRIGHT_CORE  path to a playwright-core package directory
//   CHROMIUM_PATH    path to a Chromium/Chrome executable
//   FFMPEG           ffmpeg binary (default: ffmpeg)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLAYWRIGHT_CORE =
  process.env.PLAYWRIGHT_CORE ??
  '/home/ashis/Documents/GitHub/ashiswadhwani.in/web/node_modules/.pnpm/playwright-core@1.65.0/node_modules/playwright-core';
export const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ?? '/home/ashis/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
export const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

export const fixtures = path.join(root, 'test', 'fixtures');
export const tmp = path.join(root, 'test', '.tmp');
export const shots = path.join(root, 'docs', 'readme');

export const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT_CORE);

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
  '.mind': 'application/octet-stream', '.json': 'application/json',
};

/**
 * Tiny static server on http://localhost (a secure context, so getUserMedia works).
 * `mounts` maps URL prefixes to directories; later mounts win. Supports Range for video.
 */
export function serve(mounts) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let pathname = decodeURIComponent(u.pathname);
    let file = null;
    for (const [prefix, dir] of mounts) {
      if (pathname === prefix || pathname.startsWith(prefix === '/' ? '/' : prefix + '/')) {
        const rel = pathname.slice(prefix.length).replace(/^\//, '') || 'index.html';
        const candidate = path.join(dir, rel);
        if (candidate.startsWith(dir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) file = candidate;
      }
    }
    if (!file) { res.writeHead(404); res.end('not found'); return; }
    const size = fs.statSync(file).size;
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file).pipe(res);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}
