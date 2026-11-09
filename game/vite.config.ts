import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // Relative paths so dist/ can be hosted from any folder.
  base: './',
  plugins: [vue()],
  // The glTF loader imports plain three, which has to be the same copy the renderer uses.
  resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
  server: { port: 4173 },
  preview: { port: 4173 },
  // three/webgpu uses top-level await.
  build: { target: 'esnext', chunkSizeWarningLimit: 2000 },
  test: { include: ['src/**/*.test.ts'] },
});
