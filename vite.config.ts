import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Copies the MediaPipe wasm runtime out of node_modules into public/mediapipe/wasm so it is
// self-hosted (no CDN). Runs on `vite` (dev) and `vite build`, so no postinstall script is
// needed (this repo sets ignore-scripts=true). Only the non-module loader pair is used.
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];
function copyMediapipeWasm(): Plugin {
  return {
    name: 'copy-mediapipe-wasm',
    buildStart() {
      const from = path.resolve('node_modules/@mediapipe/tasks-vision/wasm');
      const to = path.resolve('public/mediapipe/wasm');
      fs.mkdirSync(to, { recursive: true });
      for (const f of WASM_FILES) {
        const src = path.join(from, f);
        const dst = path.join(to, f);
        if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
      }
    },
  };
}

// https via a self-signed cert so phones on the LAN get camera access (getUserMedia
// needs a secure context). Used by `vite` (dev) and `vite preview`.
export default defineConfig({
  plugins: [basicSsl(), copyMediapipeWasm()],
  server: { host: true },
  preview: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
