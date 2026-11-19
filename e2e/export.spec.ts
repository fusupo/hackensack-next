// Export for player (#16): the editor downloads the bundle of the picture
// it previews, and the player draws that bundle the same way.

import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import {
  expect,
  openProject,
  pickComponent,
  projectMenu,
  saveButton,
  test,
} from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'
import { builtPlayer, iifePage, servePage } from './playerPages.ts'

const preview = (page: Page) => page.getByTestId('preview')
const exportButton = (page: Page) =>
  page.getByRole('button', { name: 'Export for player', exact: true })
const trailNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Component trail' })
const inspectorHeader = (page: Page) => page.locator('.inspector-header')
/** A param field in the inspector, by its label (start from page: see lore). */
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true })

interface ExportedBundle {
  format: string
  root: string
  components: Record<
    string,
    { nodes: Record<string, { params?: Record<string, unknown> }> }
  >
  data?: Record<string, unknown>
}

/** Clicks Export for player and reads the file the browser was handed. */
async function exportFromEditor(
  page: Page,
): Promise<{ download: Download; text: string; bundle: ExportedBundle }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportButton(page).click(),
  ])
  const text = readFileSync(await download.path(), 'utf8')
  return { download, text, bundle: JSON.parse(text) as ExportedBundle }
}

/** Open the seeded project on sun-card (it opens on sun, the first by name). */
async function openSunCard(page: Page, project: SeededProject) {
  await openProject(page, project)
  await pickComponent(page, 'sun-card')
  await expect(preview(page).locator('circle')).toHaveCount(3)
}

test("Export for player downloads the viewed component's bundle with its sample as default data", async ({
  page,
  project,
}) => {
  await openSunCard(page, project)
  const { download, bundle, text } = await exportFromEditor(page)
  expect(download.suggestedFilename()).toBe('sun-card.bundle.json')
  expect(text.endsWith('\n')).toBe(true)
  expect(bundle.format).toBe('hackensack/bundle/1')
  expect(bundle.root).toBe('sun-card')
  expect(Object.keys(bundle.components).sort()).toEqual(['sun', 'sun-card'])
  expect(bundle.data).toEqual(project.json('samples/sun-card.data.json'))
  // Editor positions stay out of it.
  for (const spec of Object.values(bundle.components)) {
    expect(spec).not.toHaveProperty('editor')
  }
})

test('Export for player exports the top of the trail while a definition is entered, and is offered for an example', async ({
  page,
  project,
}) => {
  await openSunCard(page, project)
  // Enter sun through the second instance: the preview still shows sun-card.
  await page.locator('.react-flow__node[data-id="n2"]').dblclick()
  await expect(trailNav(page)).toContainText('sun')
  const inside = await exportFromEditor(page)
  expect(inside.download.suggestedFilename()).toBe('sun-card.bundle.json')
  expect(inside.bundle.root).toBe('sun-card')

  // An example is read-only, but exporting writes nothing: it's offered.
  await projectMenu(page).selectOption('examples/sun-card')
  await pickComponent(page, 'sun-card')
  await expect(preview(page).locator('circle')).toHaveCount(3)
  await expect(exportButton(page)).toBeVisible()
  const example = await exportFromEditor(page)
  expect(example.download.suggestedFilename()).toBe('sun-card.bundle.json')
  expect(example.bundle.root).toBe('sun-card')
  expect(Object.keys(example.bundle.components).sort()).toEqual([
    'sun',
    'sun-card',
  ])
})

test('Export for player carries an edit that has not been saved', async ({
  page,
  project,
}) => {
  await openSunCard(page, project)
  await page.locator('.react-flow__controls-fitview').click()
  await page.locator('.react-flow__node[data-id="n1"] .bloq-header').click()
  await expect(inspectorHeader(page)).toContainText('n1')
  await field(page, 'radius').fill('15')
  await expect(preview(page).locator('circle').first()).toHaveAttribute(
    'r',
    '15',
  )
  await expect(saveButton(page)).toHaveText('Save (1)')

  const { bundle } = await exportFromEditor(page)
  expect(String(bundle.components['sun-card'].nodes.n1.params?.radius)).toBe(
    '15',
  )
  // The file on disk still has the old radius: the export came from memory.
  const onDisk = project.json(
    'components/sun-card.json',
  ) as unknown as ExportedBundle['components'][string]
  expect(String(onDisk.nodes.n1.params?.radius)).not.toBe('15')
  await expect(saveButton(page)).toHaveText('Save (1)')
})

test("a bundle exported from the editor draws the editor's picture in the player", async ({
  page,
  project,
}) => {
  test.setTimeout(120_000)
  await builtPlayer()
  await openSunCard(page, project)
  const editorCircles = await preview(page)
    .locator('circle')
    .evaluateAll((circles) =>
      circles.map((c) => ({
        r: c.getAttribute('r'),
        fill: c.getAttribute('fill'),
      })),
    )
  const { text } = await exportFromEditor(page)

  const player = await page.context().newPage()
  await servePage(
    player,
    iifePage(
      '<hackensack-picture src="sun-card.bundle.json"></hackensack-picture>',
    ),
    { 'sun-card.bundle.json': text },
  )
  const circles = player.locator('hackensack-picture circle')
  await expect(circles).toHaveCount(editorCircles.length)
  const playerCircles = await circles.evaluateAll((all) =>
    all.map((c) => ({ r: c.getAttribute('r'), fill: c.getAttribute('fill') })),
  )
  expect(playerCircles).toEqual(editorCircles)
  await expect(
    player.locator('hackensack-picture [data-hackensack-problems]'),
  ).toBeHidden()
})
