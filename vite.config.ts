import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// https via a self-signed cert so phones on the LAN get camera access (getUserMedia
// needs a secure context). Used by `vite` (dev) and `vite preview`.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true },
  preview: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2600, // the lazy AR chunk bundles TensorFlow.js (~2 MB)
  },
});
