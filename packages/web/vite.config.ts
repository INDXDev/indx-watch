import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './' lets the built SPA be served from any path (iw serve, Workers static assets, a sub-folder).
// `VITE_MOCK=1 pnpm dev` serves the UI with the in-browser mock API (src/mock/); otherwise /api is proxied.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  // iw serve checks Host and Origin (DNS rebinding, cross-site writes): present the proxied requests as its own
  server: {
    proxy: {
      '/api': {
        target: process.env.IW_API ?? 'http://localhost:4321',
        changeOrigin: true,
        configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
      },
    },
  },
});
