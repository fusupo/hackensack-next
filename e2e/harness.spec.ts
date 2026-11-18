import { expect, projectsDir, test } from './fixtures.ts'

interface ListedProject {
  root: string
  name: string
}

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
