// The grid node in the editor (#6). Each test seeds its own copy of sun-card;
// the raindrops tests also copy the raindrops example into it. raindrops
// draws a grid (n2, count rain / 5, five to a row, 24 apart, rows 28 apart)
// of raindrop instances (n3) inside a translate(22, 22) group. Its sample is
// 32 mm: six drops, a row of five and one more.

import { cpSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, openProject, pickComponent, test } from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'

const RAINDROPS = join(import.meta.dirname, '..', 'examples', 'raindrops')

const preview = (page: Page) => page.getByTestId('preview')
const cell = (page: Page, x: number, y: number) =>
  preview(page).locator(`g[transform="translate(${x}, ${y})"]`)
const graphNode = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`)
const inspector = (page: Page) => page.locator('.inspector')

/** The cells of a 32 mm sample, in drawing order. */
const SIX_CELLS: [number, number][] = [
  [0, 0],
  [24, 0],
  [48, 0],
  [72, 0],
  [96, 0],
  [0, 28],
]

/** Add the raindrops example to the seeded project and open it on raindrops. */
async function openRaindrops(page: Page, project: SeededProject) {
  for (const kind of ['components', 'samples'])
    cpSync(join(RAINDROPS, kind), join(project.dir, kind), { recursive: true })
  await openProject(page, project)
  await pickComponent(page, 'raindrops')
  await expect(preview(page).locator('ellipse')).toHaveCount(6)
}

test('adds a grid from the palette and edits its params in the inspector', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await pickComponent(page, 'sun-card')

  // The grid sits in the palette's Structure group.
  const structure = page.locator('.palette section', {
    has: page.getByRole('heading', { name: 'Structure', exact: true }),
  })
  await expect(structure.locator('.palette-grid')).toHaveText('grid')
  await structure.locator('.palette-grid').click()

  const card = page.locator('.react-flow__node', {
    has: page.locator('.bloq-type', { hasText: /^grid$/ }),
  })
  await expect(card).toHaveCount(1)
  // It lands left of the others, under the side panel: bring it into view.
  await page.locator('.react-flow__controls-fitview').click()
  await card.click()

  // The inspector's Repeat section holds every grid param, from the registry.
  await expect(
    inspector(page).getByRole('heading', { name: 'Repeat', exact: true }),
  ).toBeVisible()
  for (const name of [
    'count',
    'columns',
    'spacing',
    'rowSpacing',
    'col',
    'row',
    'index',
  ])
    await expect(
      inspector(page).getByLabel(name, { exact: true }),
    ).toBeVisible()
  await expect(
    inspector(page).getByLabel('columns', { exact: true }),
  ).toHaveAttribute('placeholder', '5')
  await expect(
    inspector(page).getByLabel('index', { exact: true }),
  ).toHaveAttribute('placeholder', 'n')

  await inspector(page).getByLabel('count', { exact: true }).fill('rain / 5')
  await inspector(page).getByLabel('columns', { exact: true }).fill('3')

  // The edits reach the node: its card lists them.
  const params = card.locator('.bloq-params')
  await expect(params.locator('div', { hasText: /^count/ })).toContainText(
    'rain / 5',
  )
  await expect(params.locator('div', { hasText: /^columns/ })).toContainText(
    '3',
  )
  // No children yet: one empty child slot.
  await expect(card.locator('.react-flow__handle-left')).toHaveCount(1)
  await expect(card.locator('.react-flow__handle-left.slot-empty')).toHaveCount(
    1,
  )
})

test("lists the grid's column, row and index in scope for its child", async ({
  page,
  project,
}) => {
  await openRaindrops(page, project)
  await graphNode(page, 'n3').click()

  const gridFrame = inspector(page).locator('.scope-frame', {
    has: page.getByRole('heading', { name: 'grid n2', exact: true }),
  })
  await expect(gridFrame.locator('code')).toHaveText(['col', 'row', 'n'])
  const inputs = inspector(page).locator('.scope-frame', {
    has: page.getByRole('heading', {
      name: 'inputs of raindrops',
      exact: true,
    }),
  })
  await expect(inputs.locator('code')).toHaveText(['rain'])
})

test('redraws one raindrop per 5 mm when the sample rain changes', async ({
  page,
  project,
}) => {
  await openRaindrops(page, project)
  for (const [x, y] of SIX_CELLS) await expect(cell(page, x, y)).toHaveCount(1)
  await expect(preview(page).locator('g[transform^="translate("]')).toHaveCount(
    7, // six cells and the outer translate(22, 22)
  )

  const data = page.getByRole('textbox', { name: 'Sample data (JSON)' })
  await data.fill('{ "rain": 12 }')
  await expect(preview(page).locator('ellipse')).toHaveCount(2)
  await expect(cell(page, 0, 0)).toHaveCount(1)
  await expect(cell(page, 24, 0)).toHaveCount(1)
  await expect(cell(page, 48, 0)).toHaveCount(0)
  await expect(cell(page, 0, 28)).toHaveCount(0)

  await data.fill('{ "rain": 0 }')
  await expect(preview(page).locator('ellipse')).toHaveCount(0)
  await expect(cell(page, 0, 0)).toHaveCount(0)
  await expect(cell(page, 24, 0)).toHaveCount(0)

  // No problems anywhere in the graph.
  await expect(page.locator('.bloq-problem-count')).toHaveCount(0)
})

test('highlights every raindrop a grid draws when its definition is entered', async ({
  page,
  project,
}) => {
  await openRaindrops(page, project)
  await graphNode(page, 'n3').dblclick()
  await expect(
    page.getByRole('navigation', { name: 'Component trail' }),
  ).toContainText('raindrop')

  // The instance draws one raindrop per cell: six entered elements.
  await expect(preview(page).locator('[data-entered]')).toHaveCount(6)
  for (const [x, y] of SIX_CELLS) {
    // The cell groups are drawn by raindrops itself, so they're neither
    // entered nor dimmed; the raindrop's own group inside each is entered.
    const wrapper = cell(page, x, y)
    await expect(wrapper).not.toHaveAttribute('data-entered', /.*/)
    await expect(wrapper).not.toHaveAttribute('data-dimmed', /.*/)
    await expect(wrapper.locator('> g')).toHaveAttribute('data-entered', 'true')
  }
  await expect(cell(page, 22, 22)).not.toHaveAttribute('data-dimmed', /.*/)
  await expect(preview(page).locator('[data-dimmed]')).toHaveCount(0)
})
