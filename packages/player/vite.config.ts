// Builds the player into single files a page can load (#16):
// dist/hackensack-player.js (an ES module) and dist/hackensack-player.iife.js
// (a classic script that sets window.HackensackPlayer). The engine and
// math.js are bundled in; nothing is left to import.

import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const here = import.meta.dirname

export default defineConfig({
  root: here,
  // Resolve the engine by path, so the build needs no workspace link.
  resolve: {
    alias: {
      '@hackensack/engine': resolve(here, '../engine/src/index.ts'),
    },
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: resolve(here, 'src/index.ts'),
      name: 'HackensackPlayer',
      formats: ['es', 'iife'],
      fileName: (format) =>
        format === 'es' ? 'hackensack-player.js' : 'hackensack-player.iife.js',
    },
  },
})
