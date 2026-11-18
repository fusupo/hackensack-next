// What the preview shows inside a definition (#4): the picture you came from
// with the entered instance highlighted, or the definition on its own. Each
// test seeds its own copy of sun-card, which draws `sun` three times:
// n1 at translate(40, 70), n2 at translate(120, 70), n3 at translate(240, 70).

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, openProject, pickComponent, test } from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'

const preview = (page: Page) => page.getByTestId('preview')
const entered = (page: Page) => preview(page).locator('[data-entered]')
const dimmed = (page: Page) => preview(page).locator('[data-dimmed]')
const sunAt = (page: Page, x: number, y: number) =>
  preview(page).locator(`g[transform="translate(${x}, ${y})"]`)
const modeChoice = (page: Page) =>
  page.getByRole('radiogroup', { name: 'Preview of' })
const mode = (page: Page, name: 'In context' | 'Isolated') =>
  modeChoice(page).getByRole('radio', { name })
const trailNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Component trail' })

/** Open the seeded project on sun-card, the picture that draws three suns. */
async function openSunCard(page: Page, project: SeededProject) {
  await openProject(page, project)
  await pickComponent(page, 'sun-card')
  await expect(preview(page).locator('circle')).toHaveCount(3)
}

/** Double-click an instance node in the graph to enter its definition. */
async function enter(page: Page, nodeId: string) {
  await page.locator(`.react-flow__node[data-id="${nodeId}"]`).dblclick()
  await expect(trailNav(page)).toContainText('sun')
}

test('highlights only the entered instance in the context preview', async ({
  page,
  project,
}) => {
  await openSunCard(page, project)
  await enter(page, 'n2')

  await expect(mode(page, 'In context')).toHaveAttribute('aria-checked', 'true')
  await expect(entered(page)).toHaveCount(1)
  await expect(entered(page)).toHaveAttribute('transform', 'translate(120, 70)')
  await expect(sunAt(page, 40, 70)).toHaveAttribute('data-dimmed', 'true')
  await expect(sunAt(page, 240, 70)).toHaveAttribute('data-dimmed', 'true')
  await expect(sunAt(page, 120, 70)).not.toHaveAttribute('data-dimmed', /.*/)
  // Still the whole picture: all three suns are drawn.
  await expect(preview(page).locator('circle')).toHaveCount(3)
})

test('shows no highlight and no preview toggle at the top level or after leaving a definition', async ({
  page,
  project,
}) => {
  await openSunCard(page, project)
  await expect(entered(page)).toHaveCount(0)
  await expect(dimmed(page)).toHaveCount(0)
  await expect(modeChoice(page)).toHaveCount(0)

  await enter(page, 'n2')
  await expect(modeChoice(page)).toBeVisible()
  await expect(entered(page)).toHaveCount(1)

  await trailNav(page).getByRole('button', { name: 'sun-card' }).click()
  await expect(trailNav(page)).not.toContainText('›')
  await expect(modeChoice(page)).toHaveCount(0)
  await expect(entered(page)).toHaveCount(0)
  await expect(dimmed(page)).toHaveCount(0)
})

test('switches the preview between the context picture and the entered definition on its own', async ({
  page,
  project,
}) => {
  await openSunCard(page, project)
  await enter(page, 'n2')

  await mode(page, 'Isolated').click()
  await expect(mode(page, 'Isolated')).toHaveAttribute('aria-checked', 'true')
  await expect(
    page.getByRole('region', { name: 'Preview · sun alone' }),
  ).toBeVisible()
  // sun.data.json: radius 20 at (40, 40), drawn once, nothing faded.
  await expect(preview(page).locator('circle')).toHaveCount(1)
  await expect(sunAt(page, 40, 40)).toHaveCount(1)
  await expect(preview(page).locator('circle')).toHaveAttribute('r', '20')
  await expect(dimmed(page)).toHaveCount(0)
  await expect(entered(page)).toHaveCount(0)

  await mode(page, 'In context').click()
  await expect(preview(page).locator('circle')).toHaveCount(3)
  await expect(entered(page)).toHaveCount(1)
  await expect(entered(page)).toHaveAttribute('transform', 'translate(120, 70)')
})

test('isolated preview without a sample file uses the input defaults and says so', async ({
  page,
  project,
}) => {
  rmSync(join(project.dir, 'samples', 'sun.data.json'))
  await openSunCard(page, project)
  await enter(page, 'n1')
  await mode(page, 'Isolated').click()

  // sun's input defaults: radius 20 at (0, 0).
  await expect(sunAt(page, 0, 0)).toHaveCount(1)
  await expect(preview(page).locator('circle')).toHaveAttribute('r', '20')
  await expect(page.getByRole('note')).toContainText('No sample file')
})

test('remembers the isolated preview choice after a reload', async ({
  page,
  project,
}) => {
  await openSunCard(page, project)
  await enter(page, 'n2')
  // The first time, it starts in context.
  await expect(mode(page, 'In context')).toHaveAttribute('aria-checked', 'true')
  await expect(entered(page)).toHaveCount(1)

  await mode(page, 'Isolated').click()
  await page.reload()
  await openSunCard(page, project)
  await enter(page, 'n2')

  await expect(mode(page, 'Isolated')).toHaveAttribute('aria-checked', 'true')
  await expect(preview(page).locator('circle')).toHaveCount(1)
  await expect(sunAt(page, 40, 40)).toHaveCount(1)
  await expect(dimmed(page)).toHaveCount(0)
})

test('says so when the entered instance is not drawn in the picture', async ({
  page,
  project,
}) => {
  await openSunCard(page, project)
  // A new instance of sun, not connected to anything: it draws nothing.
  await page.locator('.palette-component', { hasText: /^sun/ }).click()
  await expect(page.locator('.react-flow__node[data-id="n4"]')).toBeVisible()
  // It lands left of the others, under the side panel: bring it into view.
  await page.locator('.react-flow__controls-fitview').click()
  await enter(page, 'n4')

  await expect(page.getByRole('note')).toContainText(
    'Not drawn in this picture',
  )
  await expect(entered(page)).toHaveCount(0)
  await expect(dimmed(page)).toHaveCount(0)
  await expect(preview(page).locator('circle')).toHaveCount(3)
})

test("edits the entered definition's sample in the isolated preview", async ({
  page,
  project,
}) => {
  await openSunCard(page, project)
  const topData = await page
    .getByRole('textbox', { name: 'Sample data (JSON)' })
    .inputValue()
  await enter(page, 'n2')
  await mode(page, 'Isolated').click()

  const data = page.getByRole('region', { name: 'Sample data · sun' })
  await expect(data).toBeVisible()
  await expect(data.locator('.data-inputs code')).toHaveText([
    'radius',
    'x',
    'y',
    'color',
  ])
  await data
    .getByRole('textbox', { name: 'Sample data (JSON)' })
    .fill('{ "radius": 30, "x": 40, "y": 40, "color": "#f5b942" }')
  await expect(preview(page).locator('circle')).toHaveAttribute('r', '30')

  // sun-card's own sample is untouched.
  await mode(page, 'In context').click()
  const outer = page.getByRole('region', { name: 'Sample data · sun-card' })
  await expect(
    outer.getByRole('textbox', { name: 'Sample data (JSON)' }),
  ).toHaveValue(topData)
})
