// Undo and redo in the editor (#10). Each test seeds its own copy of the
// sun-card example: `sun-card` (n0, an svg) draws three `sun` instances, n1,
// n2 and n3 (radius 10, 20 and 40), each a group of four lines and a circle.
// Every test is a top-level `test`, so the validation contract selects it as
// `e2e/undo.spec.ts::<title>`.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  componentMenu,
  expect,
  openProject,
  pickComponent,
  projectMenu,
  saveButton,
  test,
} from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'

const preview = (page: Page) => page.getByTestId('preview')
/** One circle per sun, in instance order. */
const suns = (page: Page) => preview(page).locator('circle')
const graphNode = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`)
const nodes = (page: Page) => page.locator('.react-flow__node')
const edges = (page: Page) => page.locator('.react-flow__edge')
const fitView = (page: Page) =>
  page.locator('.react-flow__controls-fitview').click()
const undoButton = (page: Page) =>
  page.getByRole('button', { name: 'Undo', exact: true })
const redoButton = (page: Page) =>
  page.getByRole('button', { name: 'Redo', exact: true })
const inspectorHeader = (page: Page) => page.locator('.inspector-header')
const sampleData = (page: Page) =>
  page.getByRole('textbox', { name: 'Sample data (JSON)' })
const status = (page: Page) => page.getByRole('status')
/** A param field in the inspector, by its label (start from page: see lore). */
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true })
const palette = (page: Page) => page.locator('.palette')

/** Open the seeded project on sun-card (it opens on sun, the first by name). */
async function openCard(page: Page, project: SeededProject) {
  await openProject(page, project)
  await pickComponent(page, 'sun-card')
  await expect(suns(page)).toHaveCount(3)
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

/** Every node card's box, by id. */
async function boxes(page: Page) {
  const ids = await nodes(page).evaluateAll((all) =>
    all.map((n) => n.getAttribute('data-id')!),
  )
  const out: Record<string, { x: number; y: number }> = {}
  for (const id of ids) {
    const box = await graphNode(page, id).boundingBox()
    out[id] = { x: Math.round(box!.x), y: Math.round(box!.y) }
  }
  return out
}

/** Add a node from the palette; returns the new card's id. */
async function addFromPalette(page: Page, type: string) {
  const ids = () =>
    nodes(page).evaluateAll((all) => all.map((n) => n.getAttribute('data-id')!))
  const before = await ids()
  await palette(page).getByRole('button', { name: type, exact: true }).click()
  await fitView(page)
  await expect.poll(async () => (await ids()).length).toBe(before.length + 1)
  return (await ids()).find((id) => !before.includes(id))!
}

test('undoes and redoes deleting, adding and unwiring nodes in the graph', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await expect(suns(page)).toHaveCount(3)
  await expect(edges(page)).toHaveCount(3)

  // The Delete key on a wired node removes it and its wire: one step.
  await select(page, 'n3')
  await page.keyboard.press('Delete')
  await expect(suns(page)).toHaveCount(2)
  await expect(edges(page)).toHaveCount(2)
  await undoButton(page).click()
  await expect(suns(page)).toHaveCount(3)
  await expect(edges(page)).toHaveCount(3)
  await expect(graphNode(page, 'n3')).toHaveCount(1)
  await expect(undoButton(page)).toBeDisabled()
  await redoButton(page).click()
  await expect(suns(page)).toHaveCount(2)
  await expect(graphNode(page, 'n3')).toHaveCount(0)
  await undoButton(page).click()
  await expect(suns(page)).toHaveCount(3)

  // Adding a node from the palette.
  const added = await addFromPalette(page, 'circle')
  await expect(nodes(page)).toHaveCount(5)
  await undoButton(page).click()
  await expect(nodes(page)).toHaveCount(4)
  await redoButton(page).click()
  await expect(graphNode(page, added)).toHaveCount(1)

  // Wiring it into the root, then unwiring it.
  await fitView(page)
  await graphNode(page, added)
    .locator('.react-flow__handle-right')
    .dragTo(
      graphNode(page, 'n0').locator('.react-flow__handle-left.slot-empty'),
    )
  await expect(edges(page)).toHaveCount(4)
  await undoButton(page).click()
  await expect(edges(page)).toHaveCount(3)
  await redoButton(page).click()
  await expect(edges(page)).toHaveCount(4)

  await fitView(page)
  await page.locator(`.react-flow__edge[data-id="n0:3"]`).click()
  await page.keyboard.press('Delete')
  await expect(edges(page)).toHaveCount(3)
  await expect(graphNode(page, added)).toHaveCount(1)
  await undoButton(page).click()
  await expect(edges(page)).toHaveCount(4)
  await redoButton(page).click()
  await expect(edges(page)).toHaveCount(3)
})

test('undoes a node drag in one step', async ({ page, project }) => {
  await openCard(page, project)
  await fitView(page)
  const before = await boxes(page)
  const header = graphNode(page, 'n1').locator('.bloq-header')
  const box = (await header.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(
      box.x + box.width / 2 + i * 10,
      box.y + box.height / 2 + i * 8,
    )
  await page.mouse.up()
  // Park the mouse off the graph, so no card is measured while hovered.
  await page.mouse.move(0, 0)
  await expect.poll(async () => (await boxes(page)).n1).not.toEqual(before.n1)
  expect(await saveButton(page).textContent()).toBe('Save (1)')

  // One Undo puts it back, and there is nothing left to undo.
  await undoButton(page).click()
  await expect.poll(() => boxes(page)).toEqual(before)
  await expect(undoButton(page)).toBeDisabled()
  await expect(saveButton(page)).toHaveText('Saved')
})

test('keeps every node in place when the first edit is undone', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await fitView(page)
  const before = await boxes(page)

  // The first edit freezes the automatic layout: nothing moves.
  await select(page, 'n1')
  await field(page, 'radius').fill('15')
  await expect(suns(page).first()).toHaveAttribute('r', '15')
  expect(await boxes(page)).toEqual(before)

  // Undoing it brings back the unfrozen spec: still nothing moves.
  await undoButton(page).click()
  await expect(suns(page).first()).toHaveAttribute('r', '10')
  expect(await boxes(page)).toEqual(before)
  await expect(saveButton(page)).toHaveText('Saved')
  await redoButton(page).click()
  await expect(suns(page).first()).toHaveAttribute('r', '15')
  expect(await boxes(page)).toEqual(before)
})

test('undoes with Ctrl+Z, redoes with Ctrl+Shift+Z and Ctrl+Y, and leaves Ctrl+Z to a focused text field', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n1')
  await field(page, 'radius').fill('15')
  await expect(suns(page).first()).toHaveAttribute('r', '15')
  await leaveField(page)

  await page.keyboard.press('Control+z')
  await expect(suns(page).first()).toHaveAttribute('r', '10')
  await page.keyboard.press('Control+Shift+z')
  await expect(suns(page).first()).toHaveAttribute('r', '15')
  await page.keyboard.press('Control+z')
  await expect(suns(page).first()).toHaveAttribute('r', '10')
  await page.keyboard.press('Control+y')
  await expect(suns(page).first()).toHaveAttribute('r', '15')
  await page.keyboard.press('Meta+z')
  await expect(suns(page).first()).toHaveAttribute('r', '10')
  await page.keyboard.press('Meta+Shift+z')
  await expect(suns(page).first()).toHaveAttribute('r', '15')

  // In a text field, Ctrl+Z is the field's own. The input name field only
  // commits on Enter or blur, so typing in it records nothing: if the app
  // took the key, it would undo the radius edit instead.
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
  await expect(inspectorHeader(page)).toContainText('component · root n0')
  const name = page.getByLabel('Input name').first()
  await expect(name).toHaveValue('color')
  await name.click()
  await name.press('End')
  await name.pressSequentially('X')
  await page.keyboard.press('Control+z')
  // Put the name back, so leaving the field renames nothing.
  await name.fill('color')
  await leaveField(page)
  await expect(suns(page).first()).toHaveAttribute('r', '15')
  await expect(undoButton(page)).toBeEnabled()
  await expect(redoButton(page)).toBeDisabled()
  await expect(saveButton(page)).toHaveText('Save (1)')

  // Delete still deletes the selected node.
  const added = await addFromPalette(page, 'circle')
  await select(page, added)
  await page.keyboard.press('Delete')
  await expect(graphNode(page, added)).toHaveCount(0)
})

test('leaves Ctrl+Z and Ctrl+Y to the Sample data textarea', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n1')
  await field(page, 'radius').fill('15')
  await leaveField(page)
  await expect(undoButton(page)).toBeEnabled()
  await expect(redoButton(page)).toBeDisabled()

  await sampleData(page).click()
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+y')
  await page.keyboard.press('Control+Shift+z')
  // The app's history didn't move: the edit is still there, nothing to redo.
  await expect(suns(page).first()).toHaveAttribute('r', '15')
  await expect(undoButton(page)).toBeEnabled()
  await expect(redoButton(page)).toBeDisabled()
})

test('disables Undo and Redo when there is nothing to undo or redo', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await expect(undoButton(page)).toBeDisabled()
  await expect(redoButton(page)).toBeDisabled()

  await select(page, 'n2')
  await field(page, 'radius').fill('25')
  await expect(undoButton(page)).toBeEnabled()
  await expect(redoButton(page)).toBeDisabled()

  await undoButton(page).click()
  await expect(undoButton(page)).toBeDisabled()
  await expect(redoButton(page)).toBeEnabled()

  await redoButton(page).click()
  await expect(undoButton(page)).toBeEnabled()
  await expect(redoButton(page)).toBeDisabled()
})

test('clears the selection when undo removes the selected node', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  const added = await addFromPalette(page, 'rect')
  await expect(inspectorHeader(page)).toContainText(added)
  await undoButton(page).click()
  await expect(graphNode(page, added)).toHaveCount(0)
  await expect(inspectorHeader(page)).toContainText('component · root n0')
  // The selection was cleared, not left dangling: redo brings the node
  // back unselected, and the inspector stays on the component.
  await redoButton(page).click()
  await expect(graphNode(page, added)).toHaveCount(1)
  await expect(graphNode(page, added)).not.toHaveClass(/selected/)
  await expect(inspectorHeader(page)).toContainText('component · root n0')
})

test('keeps the selection when undo changes a node that still exists', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n1')
  await field(page, 'radius').fill('15')
  // Deselect, then select it again.
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
  await expect(inspectorHeader(page)).toContainText('component · root n0')
  await select(page, 'n1')

  await undoButton(page).click()
  await expect(inspectorHeader(page)).toContainText('n1')
  await expect(field(page, 'radius')).toHaveValue('10')
  await expect(suns(page).first()).toHaveAttribute('r', '10')
})

test('merges typing in one inspector field into one undo step and starts a new one after leaving it', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n1')
  const radius = field(page, 'radius')
  // One visit: three edits.
  await radius.fill('5')
  await radius.fill('55')
  await radius.fill('555')
  await expect(suns(page).first()).toHaveAttribute('r', '555')
  await leaveField(page)
  // A second visit.
  await radius.fill('7')
  await expect(suns(page).first()).toHaveAttribute('r', '7')

  await undoButton(page).click()
  await expect(radius).toHaveValue('555')
  await expect(suns(page).first()).toHaveAttribute('r', '555')
  await undoButton(page).click()
  await expect(radius).toHaveValue('10')
  await expect(suns(page).first()).toHaveAttribute('r', '10')
  await expect(undoButton(page)).toBeDisabled()

  // A new edit after an undo clears the redo steps.
  await expect(redoButton(page)).toBeEnabled()
  await radius.fill('12')
  await expect(redoButton(page)).toBeDisabled()
})

test("restores an input's default text in the inspector when its edit is undone", async ({
  page,
  project,
}) => {
  await openCard(page, project)
  const color = page.getByLabel('Default for color')
  await expect(color).toHaveValue('#f5b942')
  await color.fill('#000000')
  await leaveField(page)
  await undoButton(page).click()
  await expect(color).toHaveValue('#f5b942')
  await redoButton(page).click()
  await expect(color).toHaveValue('#000000')
})

test('undoes an input rename, a type change, an inherit toggle and an input removal', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await pickComponent(page, 'sun')
  const names = () =>
    page
      .getByLabel('Input name')
      .evaluateAll((all) => all.map((i) => (i as HTMLInputElement).value))
  await expect.poll(names).toEqual(['radius', 'x', 'y', 'color'])

  // Rename radius to size.
  const first = page.getByLabel('Input name').first()
  await first.fill('size')
  await first.press('Enter')
  await expect.poll(names).toEqual(['size', 'x', 'y', 'color'])
  await undoButton(page).click()
  await expect.poll(names).toEqual(['radius', 'x', 'y', 'color'])

  // Change x's type.
  const xType = page.getByLabel('Type of x')
  await xType.selectOption('string')
  await expect(xType).toHaveValue('string')
  await undoButton(page).click()
  await expect(xType).toHaveValue('number')

  // Toggle radius's inherit.
  const inherit = page.locator('.input-row').first().getByRole('checkbox')
  await expect(inherit).not.toBeChecked()
  await inherit.check()
  await expect(inherit).toBeChecked()
  await undoButton(page).click()
  await expect(inherit).not.toBeChecked()

  // Remove y.
  await page.getByLabel('Remove input y').click()
  await expect.poll(names).toEqual(['radius', 'x', 'color'])
  await undoButton(page).click()
  await expect.poll(names).toEqual(['radius', 'x', 'y', 'color'])
  await expect(undoButton(page)).toBeDisabled()
})

test('undoes and redoes sample data edits and the Sample data pane follows', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  const original = JSON.stringify({ color: '#f5b942' }, null, 2)
  await expect(sampleData(page)).toHaveValue(original)

  // One visit, several valid edits.
  await sampleData(page).fill('{"color": "#111111"}')
  await sampleData(page).fill('{"color": "#222222"}')
  await sampleData(page).fill('{"color": "#333333"}')
  await expect(suns(page).first()).toHaveAttribute('fill', '#333333')

  await undoButton(page).click()
  await expect(sampleData(page)).toHaveValue(original)
  await expect(suns(page).first()).toHaveAttribute('fill', '#f5b942')
  await expect(undoButton(page)).toBeDisabled()

  await redoButton(page).click()
  await expect(sampleData(page)).toHaveValue(
    JSON.stringify({ color: '#333333' }, null, 2),
  )
  await expect(suns(page).first()).toHaveAttribute('fill', '#333333')
})

test('records no undo step for sample data that is not valid JSON yet', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await sampleData(page).fill('{ "color": ')
  await expect(page.getByText(/Not valid JSON/)).toBeVisible()
  await leaveField(page)
  await expect(undoButton(page)).toBeDisabled()
  await expect(saveButton(page)).toHaveText('Saved')
  // The draft is kept while nothing changes the data.
  await expect(sampleData(page)).toHaveValue('{ "color": ')
})

test('undoes Add missing inputs', async ({ page, project }) => {
  writeFileSync(join(project.dir, 'samples', 'sun-card.data.json'), '{}\n')
  await openCard(page, project)
  await expect(sampleData(page)).toHaveValue('{}')

  await page.getByRole('button', { name: 'Add missing inputs' }).click()
  await expect(sampleData(page)).toHaveValue(
    JSON.stringify({ color: '#f5b942' }, null, 2),
  )
  await undoButton(page).click()
  await expect(sampleData(page)).toHaveValue('{}')
  await expect(undoButton(page)).toBeDisabled()
  await expect(saveButton(page)).toHaveText('Saved')
})

test('undoes an edit made in another component and names it in the status line', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await pickComponent(page, 'sun')
  const radius = page.getByLabel('Default for radius')
  await radius.fill('25')
  await leaveField(page)

  await pickComponent(page, 'sun-card')
  await undoButton(page).click()
  await expect(status(page)).toHaveText('Undid an edit in sun.')
  // The view stays where it is.
  await expect(componentMenu(page)).toHaveValue('sun-card')

  await pickComponent(page, 'sun')
  await expect(radius).toHaveValue('20')
  // On screen, no message.
  await redoButton(page).click()
  await expect(radius).toHaveValue('25')
  await expect(status(page)).not.toHaveText(/Redid/)
})

test('marks a saved file unsaved again when its edit is undone and saves the undone content', async ({
  page,
  project,
}) => {
  const radiusOnDisk = () =>
    (
      project.json('components/sun-card.json').nodes as Record<
        string,
        { params: Record<string, unknown> }
      >
    ).n1!.params.radius
  await openCard(page, project)
  await select(page, 'n1')
  await field(page, 'radius').fill('15')
  await leaveField(page)
  await expect(saveButton(page)).toHaveText('Save (1)')
  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')
  expect(radiusOnDisk()).toBe(15)

  // Undo past the save: the file is unsaved again, and Save writes the undone content.
  await undoButton(page).click()
  await expect(suns(page).first()).toHaveAttribute('r', '10')
  await expect(saveButton(page)).toHaveText('Save (1)')
  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')
  expect(radiusOnDisk()).toBe(10)

  // An edit undone before any save goes back to Saved.
  await field(page, 'radius').fill('12')
  await leaveField(page)
  await expect(saveButton(page)).toHaveText('Save (1)')
  await undoButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')
})

test('keeps the history through component and project renames and per project when switching projects', async ({
  page,
  project,
  dialogs,
}) => {
  await openCard(page, project)
  await pickComponent(page, 'sun')
  await page.getByLabel('Default for radius').fill('25')
  await leaveField(page)
  await page.getByLabel('Default for x').fill('5')
  await leaveField(page)

  // Rename sun to star: its steps follow it.
  dialogs.next({ accept: true, text: 'star' })
  await page.getByRole('button', { name: 'Rename component…' }).click()
  await expect(componentMenu(page)).toHaveValue('star')
  await undoButton(page).click()
  await expect(page.getByLabel('Default for x')).toHaveValue('0')
  await expect(page.getByLabel('Default for radius')).toHaveValue('25')
  await expect(componentMenu(page)).toHaveValue('star')

  // Rename the project: the history stays.
  const renamed = `${project.name}-renamed`
  dialogs.next({ accept: true, text: renamed })
  await page.getByRole('button', { name: 'Rename project…' }).click()
  await expect(projectMenu(page)).toHaveValue(`projects/${renamed}`)
  await expect(undoButton(page)).toBeEnabled()

  // Another project has its own (empty) history; coming back keeps this one.
  await projectMenu(page).selectOption('examples/sun-card')
  await expect(undoButton(page)).toBeDisabled()
  await expect(redoButton(page)).toBeDisabled()
  await projectMenu(page).selectOption(`projects/${renamed}`)
  await expect(undoButton(page)).toBeEnabled()
  await pickComponent(page, 'star')
  await undoButton(page).click()
  await expect(page.getByLabel('Default for radius')).toHaveValue('20')
  await expect(undoButton(page)).toBeDisabled()
})
