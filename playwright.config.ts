// Browser tests (Playwright Test). They drive the editor in Chromium against
// a dev server of its own, whose projects folder is a fresh temporary one:
// never the repo's projects/ folder, so a run can't leave the worktree dirty.
//
//   npx playwright install chromium   # once per Playwright version
//   npx playwright test               # or: npm run test:e2e
//
// With FACTORY_RESULTS_DIR set (the factory's verify), results are also
// written as JUnit to $FACTORY_RESULTS_DIR/playwright.xml.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/** A port nothing listens on right now, chosen by the OS. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('no port'))))
    })
  })
}

// Playwright loads this file in its main process and again in every worker.
// The env var makes them all agree on one folder: the main process creates
// it, the workers inherit it. The process that created it removes it when it
// exits. Not in a globalTeardown: Playwright writes into outputDir after
// teardown, and a run whose dev server fails to start never reaches it.
if (!process.env.HACKENSACK_E2E_DIR) {
  const made = mkdtempSync(join(tmpdir(), 'hackensack-e2e-'))
  process.env.HACKENSACK_E2E_DIR = made
  process.on('exit', () => rmSync(made, { recursive: true, force: true }))
}
const base = process.env.HACKENSACK_E2E_DIR
// The dev server's projects folder. Each test seeds its own project in it
// (e2e/fixtures.ts).
const projectsDir = join(base, 'projects')
mkdirSync(projectsDir, { recursive: true })

// A port of its own for each run, so a developer's `npm run dev` (5173), or
// another run's server, is never reused. The main process asks the OS for a
// free one and the workers inherit it, as with HACKENSACK_E2E_DIR.
// HACKENSACK_E2E_PORT set beforehand picks the port instead.
process.env.HACKENSACK_E2E_PORT ??= String(await freePort())
const port = process.env.HACKENSACK_E2E_PORT
const baseURL = `http://127.0.0.1:${port}`
const resultsDir = process.env.FACTORY_RESULTS_DIR

export default defineConfig({
  // No top-level testDir: the project sets it. Playwright's JUnit names each
  // file by its path from the config's rootDir, which is the top-level
  // testDir when there is one and this file's folder otherwise. With none,
  // files are named from the repo root (`e2e/x.spec.ts`), as contract
  // selectors (`e2e/x.spec.ts::title`) name them.
  //
  // Never in parallel: parallel workers freeze this machine. No retries: a
  // flaky wait should fail, not be hidden.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  outputDir: join(base, 'artifacts'),
  reporter: resultsDir
    ? [['list'], ['junit', { outputFile: join(resultsDir, 'playwright.xml') }]]
    : 'list',
  use: {
    baseURL,
    trace: 'off',
  },
  // One project, so every test runs once and appears once in the JUnit.
  projects: [
    { name: 'chromium', testDir: 'e2e', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    env: { HACKENSACK_PROJECTS: projectsDir },
    // Fail if something already answers on the port, rather than test it.
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
