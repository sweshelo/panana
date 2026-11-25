import { defineConfig } from 'vite';

import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // types only: the tokenizer is loaded from jsDelivr at run time (src/lanai/rubyTokenizer.ts)
  optimizeDeps: { exclude: ['lindera-wasm-web-ipadic'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [react(), cloudflare()],
});
