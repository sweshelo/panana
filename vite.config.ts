import { defineConfig } from 'vite';

import { cloudflare } from "@cloudflare/vite-plugin";
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [react(), cloudflare()],
});