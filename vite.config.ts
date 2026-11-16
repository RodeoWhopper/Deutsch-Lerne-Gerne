import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  plugins: [preact()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    assetsInlineLimit: 0, // CSP: no data: scripts/styles, nothing inlined
    modulePreload: { polyfill: false },
    sourcemap: false,
    target: 'es2022',
  },
  server: { proxy: { '/api': 'http://localhost:8080' } },
});
