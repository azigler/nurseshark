/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Nurseshark ships as static files under a path-based route
// (ss14.zig.computer/nurseshark/) in prod, but Vite's dev server
// serves at root locally. `base` handles both by defaulting to "/"
// and being overridden to "/nurseshark/" in the prod build via env.
//
// Build: `VITE_BASE_PATH=/nurseshark/ npm run build`
// Dev:   `npm run dev` (base = /)
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.VITE_BASE_PATH ?? '/') : '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  server: {
    port: 5517,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
}));
