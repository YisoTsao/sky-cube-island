import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH is set by the GitHub Pages workflow (e.g. /sky-cube-island/).
// Locally it falls back to a relative base so dist/ works from any folder.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
  },
} as import('vite').UserConfig);
