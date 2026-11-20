import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { projectFiles } from './server/plugin.ts'

// Where the editor saves your projects. Examples stay read-only: they are the
// golden-test fixtures (see PLAN.md principle 6).
const projectsDir = resolve(process.env.HACKENSACK_PROJECTS ?? 'projects')

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    projectFiles([
      { name: 'examples', dir: resolve('examples'), readOnly: true },
      { name: 'projects', dir: projectsDir, readOnly: false },
    ]),
  ],
  resolve: {
    // The engine is a workspace package (packages/engine). Resolve it by path
    // too, so nothing depends on the node_modules link being there.
    alias: {
      '@hackensack/engine': resolve('packages/engine/src/index.ts'),
    },
  },
  server: {
    // Saved files aren't app code; don't reload the page when they change.
    watch: { ignored: [`${projectsDir}/**`] },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'server/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    // Never run test files in parallel: parallel workers freeze this machine.
    fileParallelism: false,
    maxWorkers: 1,
  },
})
