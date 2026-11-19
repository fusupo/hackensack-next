// The path, polygon and polyline nodes in the editor (#8). Each test seeds its
// own copy of sun-card and copies the pictograms example into it. pictograms
// draws a cloud instance (a path with no holes), a drop instance (a path
// sized by its `size` input through holes, here clamp(rain, 6, 18)), a
// polyline (n5) from the `temps` list and a polygon (n6) with the literal
// points "0,-5 {wind},0 0,5". Its sample: temps [12, 15, 9, 18, 14], rain 12,
// wind 30. The drop definition's only node is its path, d0.

import { cpSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, openProject, pickComponent, test } from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'

const PICTOGRAMS = join(import.meta.dirname, '..', 'examples', 'pictograms')
/** The drop definition's path node, from examples/pictograms/components/drop.json. */
const DROP_PATH = 'd0'

const preview = (page: Page) => page.getByTestId('preview')
const graphNode = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`)
const inspector = (page: Page) => page.locator('.inspector')

/** Add the pictograms example to the seeded project and open it. */
async function openPictograms(page: Page, project: SeededProject) {
  for (const kind of ['components', 'samples'])
    cpSync(join(PICTOGRAMS, kind), join(project.dir, kind), {
      recursive: true,
    })
  await openProject(page, project)
  await pickComponent(page, 'pictograms')
  await expect(preview(page).locator('polyline')).toHaveAttribute(
    'points',
    '0,76 20,70 40,82 60,64 80,72',
  )
}

test("draws the example's path, polyline and polygon and redraws them when the sample data changes", async ({
  page,
  project,
}) => {
  await openPictograms(page, project)
  const polyline = preview(page).locator('polyline')
  const polygon = preview(page).locator('polygon')
  const drop = preview(page).locator('path').nth(1)

  await expect(preview(page).locator('path')).toHaveCount(2)
  await expect(preview(page).locator('path').first()).toHaveAttribute(
    'd',
    'M14 36a10 10 0 0 1-2-19.8A14 14 0 0 1 39 13a11 11 0 0 1 13 10.5A6.5 6.5 0 0 1 51 36z',
  )
  await expect(drop).toHaveAttribute(
    'd',
    'M 0 -12 C 7.2 -2.4, 7.2 8.4, 0 8.4 C -7.2 8.4, -7.2 -2.4, 0 -12 Z',
  )
  await expect(polygon).toHaveAttribute('points', '0,-5 30,0 0,5')

  await page
    .getByRole('textbox', { name: 'Sample data (JSON)' })
    .fill('{ "temps": [10, 20, 30], "rain": 6, "wind": 50 }')
  await expect(polyline).toHaveAttribute('points', '0,80 20,60 40,40')
  await expect(polygon).toHaveAttribute('points', '0,-5 50,0 0,5')
  await expect(drop).toHaveAttribute(
    'd',
    'M 0 -6 C 3.6 -1.2, 3.6 4.2, 0 4.2 C -3.6 4.2, -3.6 -1.2, 0 -6 Z',
  )
  await expect(page.locator('.bloq-problem-count')).toHaveCount(0)
})

test('offers path, polygon and polyline in the palette, shows their hints, and reports a bad hole on the field and the node card', async ({
  page,
  project,
}) => {
  await openPictograms(page, project)
  // sun-card has none of the new shapes, so each added card is the only one.
  await pickComponent(page, 'sun-card')

  // The three shapes sit in the palette's Shapes group.
  const shapes = page.locator('.palette section', {
    has: page.getByRole('heading', { name: 'Shapes', exact: true }),
  })
  for (const type of ['path', 'polygon', 'polyline'])
    await expect(shapes.locator(`.palette-${type}`)).toHaveText(type)

  /** Add a node from the palette and select it. */
  async function add(type: string) {
    await shapes.locator(`.palette-${type}`).click()
    const card = page.locator('.react-flow__node', {
      has: page.locator('.bloq-type', { hasText: new RegExp(`^${type}$`) }),
    })
    await expect(card).toHaveCount(1)
    // It lands left of the others, under the side panel: bring it into view.
    await page.locator('.react-flow__controls-fitview').click()
    await card.click()
  }
  const styleFields = [
    'fill',
    'stroke',
    'fill-rule',
    'stroke-linecap',
    'stroke-linejoin',
  ]

  await add('path')
  await expect(
    inspector(page).getByLabel('d', { exact: true }),
  ).toHaveAttribute('title', /braces/)
  for (const name of styleFields)
    await expect(
      inspector(page).getByLabel(name, { exact: true }),
    ).toBeVisible()

  await add('polygon')
  await expect(
    inspector(page).getByLabel('points', { exact: true }),
  ).toHaveAttribute('title', /list/)
  for (const name of styleFields)
    await expect(
      inspector(page).getByLabel(name, { exact: true }),
    ).toBeVisible()

  // A palette-added node isn't connected, so it isn't compiled: check a bad
  // hole on the drop definition's path, which renders with its own sample.
  await pickComponent(page, 'drop')
  await graphNode(page, DROP_PATH).click()
  const d = inspector(page).getByLabel('d', { exact: true })
  // `has` matches inside each .field, so its locator starts from the page.
  const dField = inspector(page).locator('.field', {
    has: page.getByLabel('d', { exact: true }),
  })
  const problemCount = graphNode(page, DROP_PATH).locator('.bloq-problem-count')

  await d.fill('M 0 0 L {size')
  await expect(dField.locator('.field-problem')).toContainText('unclosed')
  await expect(d).toHaveAttribute('aria-invalid', 'true')
  await expect(problemCount).toBeVisible()

  await d.fill('M 0 0 L {size * 2} 0 Z')
  await expect(dField.locator('.field-problem')).toHaveCount(0)
  await expect(d).toHaveAttribute('aria-invalid', 'false')
  await expect(problemCount).toHaveCount(0)
  await expect(preview(page).locator('path')).toHaveAttribute(
    'd',
    'M 0 0 L 20 0 Z',
  )
})
