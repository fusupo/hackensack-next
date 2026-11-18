import { relative } from 'node:path'
import { expect, projectsDir, test } from './fixtures.ts'

interface ListedProject {
  root: string
  name: string
}

// Checks of the browser-test setup itself (playwright.config.ts). Grouped,
// so their JUnit names read `harness › <title>`, and a contract selector
// names one as `e2e/harness.spec.ts::harness › <title>`.
test.describe('harness', () => {
  test('uses one worker, no retries and a temporary projects folder', async ({
    request,
    project,
  }, testInfo) => {
    expect(testInfo.config.workers).toBe(1)
    expect(testInfo.config.fullyParallel).toBe(false)
    expect(testInfo.project.retries).toBe(0)

    // The dev server serves the temporary folder this run seeded, not the
    // repo's projects/ folder (which holds sun-card-too).
    expect(projectsDir()).not.toContain(process.cwd())
    const response = await request.get('/__hackensack/projects')
    expect(response.ok()).toBe(true)
    const writable = ((await response.json()) as ListedProject[])
      .filter((p) => p.root === 'projects')
      .map((p) => p.name)
    expect(writable).toContain(project.name)
    expect(writable).not.toContain('sun-card-too')
  })

  test('serves on the port chosen for this run', async ({ baseURL, page }) => {
    // The config's main process picked the port and handed it down.
    const port = process.env.HACKENSACK_E2E_PORT
    expect(port).toMatch(/^\d+$/)
    expect(new URL(baseURL ?? '').port).toBe(port)

    const response = await page.goto('/')
    expect(response?.ok()).toBe(true)
    expect(new URL(page.url()).port).toBe(port)
  })

  test('names its file from the repo root', async ({}, testInfo) => {
    // Playwright's JUnit classname is this same path, from the config's
    // rootDir. Contract selectors name the file this way.
    expect(relative(testInfo.config.rootDir, testInfo.file)).toBe(
      'e2e/harness.spec.ts',
    )
  })
})
