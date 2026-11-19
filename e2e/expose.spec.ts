// Exposing params in the inspector (#11). Each test seeds its own copy of the
// sun-card example: `sun-card` (n0, an svg with width 320 and height 140)
// draws three `sun` instances, n1, n2 and n3, at x 40, 120 and 240. Each sun
// is a group translated to its x and y. Every test is a top-level `test`, so
// the validation contract selects it as `e2e/expose.spec.ts::<title>`.

import type { Page } from '@playwright/test'
import {
  expect,
  openProject,
  pickComponent,
  saveButton,
  test,
} from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'

const preview = (page: Page) => page.getByTestId('preview')
const graphNode = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`)
const nodes = (page: Page) => page.locator('.react-flow__node')
const fitView = (page: Page) =>
  page.locator('.react-flow__controls-fitview').click()
const inspectorHeader = (page: Page) => page.locator('.inspector-header')
const palette = (page: Page) => page.locator('.palette')
const undoButton = (page: Page) =>
  page.getByRole('button', { name: 'Undo', exact: true })
const redoButton = (page: Page) =>
  page.getByRole('button', { name: 'Redo', exact: true })

const exposeHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Exposed variables', exact: true })
/** The "Expose a param" select (start from page: see the lore). */
const exposeSelect = (page: Page) =>
  page.getByRole('combobox', { name: 'Expose a param', exact: true })
/** The name field of the row exposing `param`. */
const nameField = (page: Page, param: string) =>
  page.getByRole('textbox', { name: `Variable name for ${param}`, exact: true })
/** The param picker of the variable called `name`. */
const paramPicker = (page: Page, name: string) =>
  page.getByRole('combobox', { name: `Param exposed as ${name}`, exact: true })
const removeButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Stop exposing ${name}`, exact: true })
/** A param field in the inspector, by its label. */
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true })
/** The scope panel's frame for what n0 exposes. */
const exposedByCard = (page: Page) =>
  page.locator('.scope-frame', {
    has: page.getByRole('heading', { name: 'exposed by svg n0', exact: true }),
  })
const sunGroup = (page: Page, index: number) =>
  preview(page).locator('svg > g').nth(index)

async function optionTexts(page: Page) {
  return (await exposeSelect(page).locator('option').allTextContents()).map(
    (t) => t.trim(),
  )
}

/** Open the seeded project on sun-card (it opens on sun, the first by name). */
async function openCard(page: Page, project: SeededProject) {
  await openProject(page, project)
  await pickComponent(page, 'sun-card')
  await expect(preview(page).locator('circle')).toHaveCount(3)
}

/** Select a node by clicking its card's header. */
async function select(page: Page, id: string) {
  await fitView(page)
  await graphNode(page, id).locator('.bloq-header').click()
  await expect(inspectorHeader(page)).toContainText(id)
}

/** Click somewhere neutral, so the focused field loses focus. */
async function leaveField(page: Page) {
  await page.locator('h1').click()
}

/** Add a node from the palette and select it; returns its id. */
async function addAndSelect(page: Page, type: string) {
  const ids = () =>
    nodes(page).evaluateAll((all) => all.map((n) => n.getAttribute('data-id')!))
  const before = await ids()
  await palette(page).getByRole('button', { name: type, exact: true }).click()
  await fitView(page)
  await expect.poll(async () => (await ids()).length).toBe(before.length + 1)
  const id = (await ids()).find((i) => !before.includes(i))!
  await select(page, id)
  return id
}

/** Save, and return sun-card's n0 as written to disk. */
async function savedCard(page: Page, project: SeededProject) {
  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')
  const spec = project.json('components/sun-card.json') as {
    nodes: Record<string, Record<string, unknown>>
  }
  return spec.nodes.n0!
}

/** Expose `param` on the selected node, checking it got its default name. */
async function expose(page: Page, param: string) {
  await exposeSelect(page).selectOption(param)
  await expect(nameField(page, param)).toHaveValue(param)
}

/** Rename a variable by typing and pressing Enter. */
async function renameWithEnter(page: Page, param: string, to: string) {
  await nameField(page, param).fill(to)
  await nameField(page, param).press('Enter')
  await expect(nameField(page, param)).toHaveValue(to)
}

test('shows Exposed variables on an svg node and not on a component, each or grid node', async ({
  page,
  project,
}) => {
  await openCard(page, project)

  await select(page, 'n0')
  await expect(exposeHeading(page)).toBeVisible()
  await expect(exposeSelect(page)).toBeVisible()

  // A component instance doesn't draw an element of its own.
  await select(page, 'n1')
  await expect(inspectorHeader(page)).toContainText('sun')
  await expect(exposeHeading(page)).toHaveCount(0)
  await expect(exposeSelect(page)).toHaveCount(0)

  for (const type of ['each', 'grid']) {
    await addAndSelect(page, type)
    await expect(inspectorHeader(page)).toContainText(type)
    await expect(exposeHeading(page)).toHaveCount(0)
    await expect(exposeSelect(page)).toHaveCount(0)
  }

  // Any element node has it, a newly added circle too.
  await addAndSelect(page, 'circle')
  await expect(exposeHeading(page)).toBeVisible()
})

test('picking width exposes it as width on the svg node and offers only params the node sets', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n0')

  // n0 sets width and height; viewBox and preserveAspectRatio aren't set.
  expect(await optionTexts(page)).toEqual([
    'Expose a param…',
    'width',
    'height',
  ])
  await expect(nameField(page, 'width')).toHaveCount(0)

  await exposeSelect(page).selectOption('width')
  await expect(nameField(page, 'width')).toHaveValue('width')
  await expect(paramPicker(page, 'width')).toHaveValue('width')
  // Width is exposed now, so only height is left to offer.
  expect(await optionTexts(page)).toEqual(['Expose a param…', 'height'])
  // The select goes back to its prompt.
  await expect(exposeSelect(page)).toHaveValue('')

  // A child sees it in its scope panel.
  await select(page, 'n1')
  await expect(exposedByCard(page)).toContainText('width')
  await expect(exposedByCard(page)).toContainText('its width: 320')

  expect((await savedCard(page, project)).expose).toEqual({ width: 'width' })
})

test('refuses an exposed variable name that is invalid or already taken', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n0')
  await expose(page, 'width')
  await expose(page, 'height')

  // Not a valid name: marked while typed, and Enter puts the name back.
  await nameField(page, 'width').fill('2w')
  await expect(nameField(page, 'width')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('.expose-row .field-problem')).toHaveText(
    'A name starts with a letter or _ and has only letters, digits and _.',
  )
  await nameField(page, 'width').press('Enter')
  await expect(nameField(page, 'width')).toHaveValue('width')
  await expect(nameField(page, 'width')).toHaveAttribute(
    'aria-invalid',
    'false',
  )
  await expect(page.locator('.expose-row .field-problem')).toHaveCount(0)

  // Taken by the other entry: marked while typed, and leaving the field puts
  // the name back.
  await nameField(page, 'width').fill('height')
  await expect(nameField(page, 'width')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('.expose-row .field-problem')).toHaveText(
    '"height" is already exposed by this node.',
  )
  await leaveField(page)
  await expect(nameField(page, 'width')).toHaveValue('width')
  await expect(nameField(page, 'width')).toHaveAttribute(
    'aria-invalid',
    'false',
  )

  // Neither refused name reached the node.
  expect((await savedCard(page, project)).expose).toEqual({
    width: 'width',
    height: 'height',
  })
})

test('renames an exposed variable on Enter and on blur, keeping its position', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n0')
  await expose(page, 'width')
  await expose(page, 'height')

  // The first entry, renamed with Enter.
  await renameWithEnter(page, 'width', 'cardW')
  // The second, renamed by leaving the field.
  await nameField(page, 'height').fill('cardH')
  await leaveField(page)
  await expect(nameField(page, 'height')).toHaveValue('cardH')
  await expect(paramPicker(page, 'cardH')).toHaveValue('height')

  // Both kept their places: first width, then height.
  const names = page.locator('.expose-row input')
  await expect(names).toHaveCount(2)
  await expect(names.nth(0)).toHaveValue('cardW')
  await expect(names.nth(1)).toHaveValue('cardH')
  const saved = (await savedCard(page, project)).expose as Record<
    string,
    string
  >
  expect(Object.entries(saved)).toEqual([
    ['cardW', 'width'],
    ['cardH', 'height'],
  ])

  await select(page, 'n1')
  await expect(exposedByCard(page).locator('code')).toHaveText([
    'cardW',
    'cardH',
  ])
})

test('repoints and removes exposed variables and drops the expose key with the last one', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n0')
  await expose(page, 'width')
  await expose(page, 'height')

  // Point the variable called width at the height param.
  await paramPicker(page, 'width').selectOption('height')
  await expect(paramPicker(page, 'width')).toHaveValue('height')
  expect((await savedCard(page, project)).expose).toEqual({
    width: 'height',
    height: 'height',
  })

  await removeButton(page, 'height').click()
  await expect(paramPicker(page, 'height')).toHaveCount(0)
  await expect(paramPicker(page, 'width')).toHaveValue('height')
  expect((await savedCard(page, project)).expose).toEqual({ width: 'height' })

  await removeButton(page, 'width').click()
  await expect(page.locator('.expose-row')).toHaveCount(0)
  const card = await savedCard(page, project)
  expect('expose' in card).toBe(false)
  expect(card.params).toEqual({ width: 320, height: 140 })
})

test("a child's expression reads the exposed variable cardW and the preview follows", async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await expect(sunGroup(page, 0)).toHaveAttribute(
    'transform',
    'translate(40, 70)',
  )

  await select(page, 'n0')
  await expose(page, 'width')
  await renameWithEnter(page, 'width', 'cardW')

  await select(page, 'n1')
  await expect(exposedByCard(page)).toContainText('cardW')
  await expect(exposedByCard(page)).toContainText('its width: 320')

  // Centre the first sun on the card: x = 320 / 2.
  await field(page, 'x').fill('cardW / 2')
  await expect(sunGroup(page, 0)).toHaveAttribute(
    'transform',
    'translate(160, 70)',
  )
  await expect(field(page, 'x')).toHaveAttribute('aria-invalid', 'false')
})

test('clearing an exposed param keeps the entry, shows it as not set in the picker and reports it on the node', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n0')
  await expose(page, 'width')

  const problem = page.locator('.inspector > .field-problem', {
    hasText: `can't expose "width": this node doesn't set it`,
  })
  await expect(problem).toHaveCount(0)

  await field(page, 'width').fill('')
  // The entry stays, its picker shows the missing param, and the engine's
  // problem shows on the node.
  await expect(nameField(page, 'width')).toHaveValue('width')
  await expect(paramPicker(page, 'width')).toHaveValue('width')
  await expect(paramPicker(page, 'width').locator('option:checked')).toHaveText(
    '(not set) width',
  )
  await expect(problem).toBeVisible()
  // width isn't set any more, so it isn't offered either.
  expect(await optionTexts(page)).toEqual(['Expose a param…', 'height'])

  // Setting it again clears the problem.
  await field(page, 'width').fill('300')
  await expect(problem).toHaveCount(0)
  await expect(paramPicker(page, 'width').locator('option:checked')).toHaveText(
    'width',
  )
})

test('undoes and redoes exposing, renaming, repointing and removing a variable', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n0')

  // Exposing.
  await expose(page, 'width')
  await undoButton(page).click()
  await expect(nameField(page, 'width')).toHaveCount(0)
  await redoButton(page).click()
  await expect(nameField(page, 'width')).toHaveValue('width')

  // Renaming.
  await renameWithEnter(page, 'width', 'cardW')
  await undoButton(page).click()
  await expect(nameField(page, 'width')).toHaveValue('width')
  await redoButton(page).click()
  await expect(nameField(page, 'width')).toHaveValue('cardW')

  // Repointing.
  await paramPicker(page, 'cardW').selectOption('height')
  await expect(nameField(page, 'height')).toHaveValue('cardW')
  await undoButton(page).click()
  await expect(paramPicker(page, 'cardW')).toHaveValue('width')
  await redoButton(page).click()
  await expect(paramPicker(page, 'cardW')).toHaveValue('height')

  // Removing.
  await removeButton(page, 'cardW').click()
  await expect(page.locator('.expose-row')).toHaveCount(0)
  await undoButton(page).click()
  await expect(paramPicker(page, 'cardW')).toHaveValue('height')
  await redoButton(page).click()
  await expect(page.locator('.expose-row')).toHaveCount(0)

  // Each was one step: one undo brings the row back, three more go back to
  // before anything was exposed, with nothing left to undo.
  await undoButton(page).click()
  await expect(paramPicker(page, 'cardW')).toHaveValue('height')
  for (let i = 0; i < 3; i++) await undoButton(page).click()
  await expect(page.locator('.expose-row')).toHaveCount(0)
  await expect(undoButton(page)).toBeDisabled()
})

test('saves expose into the component file', async ({ page, project }) => {
  await openCard(page, project)
  await select(page, 'n0')
  await expose(page, 'width')
  await renameWithEnter(page, 'width', 'cardW')

  expect((await savedCard(page, project)).expose).toEqual({ cardW: 'width' })

  // A fresh load shows the same entry.
  await openCard(page, project)
  await select(page, 'n0')
  await expect(nameField(page, 'width')).toHaveValue('cardW')
  await expect(paramPicker(page, 'cardW')).toHaveValue('width')
})
