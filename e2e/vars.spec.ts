// The vars node in the editor (#50): added from the Palette, wired like any
// node that takes children, and its named values edited in the inspector.
// Each test seeds its own copy of the sun-card example: `sun-card` (n0, an
// svg) draws three `sun` instances, n1, n2 and n3, each a circle. Every test
// is a top-level `test`, so the validation contract selects it as
// `e2e/vars.spec.ts::<title>`.

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

const varsHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Named values', exact: true })
const addName = (page: Page) =>
  page.getByRole('button', { name: 'Add a name', exact: true })
/** The name field of the row at `position` (from 1). */
const nameField = (page: Page, position: number) =>
  page.getByRole('textbox', { name: `Name of value ${position}`, exact: true })
const expressionField = (page: Page, name: string) =>
  page.getByRole('textbox', { name: `Expression of ${name}`, exact: true })
const rowButton = (page: Page, label: string) =>
  page.getByRole('button', { name: label, exact: true })
const rows = (page: Page) => page.locator('.var-row')
/** The names in the inspector, in order. */
const names = (page: Page) =>
  page
    .locator('.var-name')
    .evaluateAll((all) => all.map((el) => (el as HTMLInputElement).value))
/** A param field in the inspector, by its label. */
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true })

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

/** Plug a child's output into its parent's empty slot. */
async function wire(page: Page, child: string, parent: string) {
  await fitView(page)
  await graphNode(page, child)
    .locator('.react-flow__handle-right')
    .dragTo(
      graphNode(page, parent).locator('.react-flow__handle-left.slot-empty'),
    )
}

/** Save, and return sun-card's nodes as written to disk. */
async function savedNodes(page: Page, project: SeededProject) {
  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')
  const spec = project.json('components/sun-card.json') as {
    nodes: Record<string, Record<string, unknown>>
  }
  return spec.nodes
}

test('the Palette adds a vars node that takes wired children', async ({
  page,
  project,
}) => {
  await openCard(page, project)

  // Under Structure, with the other nodes that draw nothing themselves.
  const structure = palette(page).locator('section', {
    has: page.getByRole('heading', { name: 'Structure', exact: true }),
  })
  await expect(
    structure.getByRole('button', { name: 'vars', exact: true }),
  ).toBeVisible()

  const v = await addAndSelect(page, 'vars')
  await expect(inspectorHeader(page)).toContainText('vars')
  await expect(varsHeading(page)).toBeVisible()
  // No children yet: one empty child slot.
  const card = graphNode(page, v)
  await expect(card.locator('.react-flow__handle-left')).toHaveCount(1)
  await expect(card.locator('.react-flow__handle-left.slot-empty')).toHaveCount(
    1,
  )

  // Wire it into the picture, then a circle and a rect into it.
  await wire(page, v, 'n0')
  const c = await addAndSelect(page, 'circle')
  await field(page, 'r').fill('7')
  await wire(page, c, v)
  const r = await addAndSelect(page, 'rect')
  await field(page, 'width').fill('9')
  await field(page, 'height').fill('9')
  await wire(page, r, v)

  // Two children and an empty slot; both draw in the preview, in order.
  await expect(card.locator('.react-flow__handle-left')).toHaveCount(3)
  await expect(card.locator('.react-flow__handle-left.slot-empty')).toHaveCount(
    1,
  )
  await expect(preview(page).locator('circle[r="7"]')).toHaveCount(1)
  await expect(preview(page).locator('rect[width="9"]')).toHaveCount(1)

  const saved = await savedNodes(page, project)
  expect(saved[v]).toEqual({ type: 'vars', children: [c, r] })
  expect(saved.n0!.children).toEqual(['n1', 'n2', 'n3', v])
})

test('building a vars node in the editor changes the preview', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  const v = await addAndSelect(page, 'vars')
  await wire(page, v, 'n0')

  // Name a value and give it an expression.
  await select(page, v)
  await addName(page).click()
  await expect(nameField(page, 1)).toHaveValue('value')
  await nameField(page, 1).fill('rad')
  await nameField(page, 1).press('Enter')
  await expect(nameField(page, 1)).toHaveValue('rad')
  await expressionField(page, 'rad').fill('6 * 2')

  // A circle below it reads the name.
  const c = await addAndSelect(page, 'circle')
  await field(page, 'r').fill('rad')
  await wire(page, c, v)
  await expect(preview(page).locator('circle')).toHaveCount(4)
  await expect(preview(page).locator('circle[r="12"]')).toHaveCount(1)
  // Its scope panel lists the name, under the vars node.
  await select(page, c)
  const frame = page.locator('.scope-frame', {
    has: page.getByRole('heading', { name: `vars ${v}`, exact: true }),
  })
  await expect(frame).toContainText('rad')
  await expect(frame).toContainText('6 * 2')

  // Changing the value changes the picture.
  await select(page, v)
  await expressionField(page, 'rad').fill('17')
  await expect(preview(page).locator('circle[r="17"]')).toHaveCount(1)
  await expect(preview(page).locator('circle[r="12"]')).toHaveCount(0)
  // The card lists the name and its expression.
  await expect(graphNode(page, v)).toContainText('rad')
  await expect(graphNode(page, v)).toContainText('17')
})

test('the inspector adds, renames, edits, reorders and removes vars names and refuses an invalid, a taken and a constant name', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  const v = await addAndSelect(page, 'vars')
  // Wired into the picture, so the engine compiles it and reports problems.
  await wire(page, v, 'n0')
  await select(page, v)

  // Add: default names, at the end.
  await addName(page).click()
  await addName(page).click()
  await expect.poll(() => names(page)).toEqual(['value', 'value2'])

  // The name is checked as you type: invalid, taken, a constant.
  const first = nameField(page, 1)
  const refusals: [string, string][] = [
    [
      '2x',
      'A name starts with a letter or _ and has only letters, digits and _.',
    ],
    ['value2', '"value2" is already a name in this node.'],
    ['pi', '"pi" is a math.js constant; choose another name.'],
  ]
  for (const [typed, message] of refusals) {
    await first.fill(typed)
    await expect(first).toHaveAttribute('aria-invalid', 'true')
    await expect(rows(page).first()).toContainText(message)
  }
  // A refused name isn't applied.
  await first.press('Enter')
  await expect(first).toHaveValue('value')
  await expect(first).toHaveAttribute('aria-invalid', 'false')

  // Rename on leaving the field, keeping the position.
  await first.fill('first')
  await leaveField(page)
  await expect.poll(() => names(page)).toEqual(['first', 'value2'])

  // Edit an expression: value2 reads first, above it.
  await expressionField(page, 'first').fill('3')
  await expressionField(page, 'value2').fill('first * 2')
  await expect(rows(page).nth(1)).not.toContainText('reads')

  // Reorder: value2 above first reads a later name, which is reported on
  // its row; moving it back clears it.
  await expect(rowButton(page, 'Move first up')).toBeDisabled()
  await expect(rowButton(page, 'Move value2 down')).toBeDisabled()
  await rowButton(page, 'Move value2 up').click()
  await expect.poll(() => names(page)).toEqual(['value2', 'first'])
  await expect(rows(page).first()).toContainText(
    '"value2" reads "first", defined after it',
  )
  await rowButton(page, 'Move value2 down').click()
  await expect.poll(() => names(page)).toEqual(['first', 'value2'])
  await expect(rows(page).nth(1)).not.toContainText('defined after it')

  // Saved in that order.
  const saved = await savedNodes(page, project)
  expect(saved[v]).toEqual({
    type: 'vars',
    vars: { first: '3', value2: 'first * 2' },
  })
  expect(Object.keys(saved[v]!.vars as object)).toEqual(['first', 'value2'])

  // Remove; the vars key goes with the last one.
  await rowButton(page, 'Remove first').click()
  await expect.poll(() => names(page)).toEqual(['value2'])
  await rowButton(page, 'Remove value2').click()
  await expect(rows(page)).toHaveCount(0)
  const emptied = await savedNodes(page, project)
  expect(emptied[v]).toEqual({ type: 'vars' })
})

test('undo and redo step through every kind of vars edit', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await addAndSelect(page, 'vars')
  // Adding the node was a step of its own; start from a clean history here.

  // Add.
  await addName(page).click()
  await expect.poll(() => names(page)).toEqual(['value'])
  await undoButton(page).click()
  await expect(rows(page)).toHaveCount(0)
  await redoButton(page).click()
  await expect.poll(() => names(page)).toEqual(['value'])

  // Rename.
  await nameField(page, 1).fill('a')
  await nameField(page, 1).press('Enter')
  await expect.poll(() => names(page)).toEqual(['a'])
  await undoButton(page).click()
  await expect(nameField(page, 1)).toHaveValue('value')
  await redoButton(page).click()
  await expect(nameField(page, 1)).toHaveValue('a')

  // Edit an expression.
  await expressionField(page, 'a').fill('5')
  await leaveField(page)
  await undoButton(page).click()
  await expect(expressionField(page, 'a')).toHaveValue('0')
  await redoButton(page).click()
  await expect(expressionField(page, 'a')).toHaveValue('5')

  // Move.
  await addName(page).click()
  await expect.poll(() => names(page)).toEqual(['a', 'value'])
  await rowButton(page, 'Move value up').click()
  await expect.poll(() => names(page)).toEqual(['value', 'a'])
  await undoButton(page).click()
  await expect.poll(() => names(page)).toEqual(['a', 'value'])
  await redoButton(page).click()
  await expect.poll(() => names(page)).toEqual(['value', 'a'])

  // Remove.
  await rowButton(page, 'Remove a').click()
  await expect.poll(() => names(page)).toEqual(['value'])
  await undoButton(page).click()
  await expect.poll(() => names(page)).toEqual(['value', 'a'])
  await expect(expressionField(page, 'a')).toHaveValue('5')
  await redoButton(page).click()
  await expect.poll(() => names(page)).toEqual(['value'])
})
