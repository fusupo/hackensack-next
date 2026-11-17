import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Never run test files in parallel: parallel workers freeze this machine.
    fileParallelism: false,
    maxWorkers: 1,
  },
})
