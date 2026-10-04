import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' so the built app works from any static host or a file share.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
});
