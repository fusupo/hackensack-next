// Node labels (#59): an optional `label` names what a node stands for. Each
// test seeds its own copy of the sun-card example (`sun-card`, n0, an svg
// holding three `sun` instances n1, n2 and n3); some rewrite its files first,
// and the windmill tests copy the labelled windmill example in. Every test is
// a top-level `test`, so the validation contract selects it as
// `e2e/labels.spec.ts::<title>`.

import { cpSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  answerName,
  dialogOf,
  expect,
  openProject,
  pickComponent,
  test,
} from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'

const WINDMILL = join(import.meta.dirname, '..', 'examples', 'windmill')

const preview = (page: Page) => page.getByTestId('preview')
const graphNode = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`)
const cardLabel = (page: Page, id: string) =>
  graphNode(page, id).locator('.bloq-label')
const cardType = (page: Page, id: string) =>
  graphNode(page, id).locator('.bloq-type')
const fitView = (page: Page) =>
  page.locator('.react-flow__controls-fitview').click()
const inspectorHeader = (page: Page) => page.locator('.inspector-header')
/** The inspector's Label field (from page, see lore). */
const labelField = (page: Page) => page.getByLabel('Label', { exact: true })
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
/** The status line (not the problems panel, which is also a status). */
const status = (page: Page) => page.locator('.status')
/** The preview's problems list. */
const problemsList = (page: Page) => page.locator('.problems')
const findBox = (page: Page) =>
  page.getByRole('searchbox', { name: 'Find node' })
const matches = (page: Page) =>
  page.getByRole('listbox', { name: 'Matching nodes' }).getByRole('option')

/** Rewrite one of the seeded project's component files before it is opened. */
function rewrite(
  project: SeededProject,
  name: string,
  change: (spec: Record<string, unknown>) => void,
) {
  const path = `components/${name}.json`
  const spec = project.json(path)
  change(spec)
  writeFileSync(join(project.dir, path), JSON.stringify(spec, null, 2))
}

/** Write a new component file into the seeded project. */
function write(project: SeededProject, name: string, spec: unknown) {
  writeFileSync(
    join(project.dir, `components/${name}.json`),
    JSON.stringify(spec, null, 2),
  )
}

const nodesOf = (spec: Record<string, unknown>) =>
  spec.nodes as Record<string, Record<string, unknown>>

/** Add nodes to sun-card and wire them under its root n0. */
function addToCard(
  project: SeededProject,
  nodes: Record<string, Record<string, unknown>>,
  wired: string[] = Object.keys(nodes),
) {
  rewrite(project, 'sun-card', (spec) => {
    const all = nodesOf(spec)
    Object.assign(all, nodes)
    all.n0.children = [...(all.n0.children as string[]), ...wired]
  })
}

/** Open the seeded project on sun-card (it opens on sun, the first by name). */
async function openCard(
  page: Page,
  project: SeededProject,
  circles: number | null = 3,
) {
  await openProject(page, project)
  await pickComponent(page, 'sun-card')
  if (circles === null) await expect(graphNode(page, 'n0')).toBeVisible()
  else await expect(preview(page).locator('circle')).toHaveCount(circles)
}

/** Add the windmill example to the seeded project and open it on windmill. */
async function openWindmill(page: Page, project: SeededProject) {
  for (const kind of ['components', 'samples'])
    cpSync(join(WINDMILL, kind), join(project.dir, kind), { recursive: true })
  await openProject(page, project)
  await pickComponent(page, 'windmill')
  await expect(graphNode(page, 'w8')).toBeVisible()
}

/** Select a node by clicking its card's header. */
async function select(page: Page, id: string) {
  await fitView(page)
  await graphNode(page, id).locator('.bloq-header').click()
  await expect(inspectorHeader(page)).toContainText(id)
}

/** A node card's height on screen, and as the card's own style says. */
async function cardHeight(page: Page, id: string) {
  const card = graphNode(page, id).locator('.bloq')
  return {
    style: await card.evaluate((el) => (el as HTMLElement).style.height),
    box: (await card.boundingBox())!.height,
  }
}

/** How far a node's centre is from the centre of the graph's canvas, in px. */
async function offCentre(page: Page, id: string) {
  const pane = (await page.locator('.react-flow').boundingBox())!
  const node = (await graphNode(page, id).boundingBox())!
  return Math.hypot(
    node.x + node.width / 2 - (pane.x + pane.width / 2),
    node.y + node.height / 2 - (pane.y + pane.height / 2),
  )
}

test('a label that is a list is a problem on its node, the card shows no label and the picture still draws', async ({
  page,
  project,
}) => {
  addToCard(project, {
    n4: {
      type: 'rect',
      label: ['sky'],
      params: { width: 10, height: 10, fill: '#123456' },
    },
  })
  await openCard(page, project)
  // The picture still draws: the suns and the rect.
  await expect(preview(page).locator('rect[fill="#123456"]')).toHaveCount(1)
  await expect(problemsList(page)).toContainText('sun-card · n4')
  await expect(problemsList(page)).toContainText(
    'label must be text, not a list',
  )
  await fitView(page)
  await expect(cardLabel(page, 'n4')).toHaveCount(0)
  await expect(cardType(page, 'n4')).toHaveText('rect')
  await select(page, 'n4')
  await expect(labelField(page)).toHaveValue('')
  await expect(page.locator('.inspector .field-problem')).toContainText(
    'label must be text, not a list',
  )
})

test("an instance card shows its label beside the component's name and unlabelled cards stay as they were", async ({
  page,
  project,
}) => {
  rewrite(project, 'sun-card', (spec) => {
    nodesOf(spec).n1.label = 'left sun'
  })
  await openCard(page, project)
  await fitView(page)
  await expect(cardLabel(page, 'n1')).toHaveText('left sun')
  await expect(cardType(page, 'n1')).toHaveText('sun')
  await expect(graphNode(page, 'n1').locator('.bloq-header')).toHaveText(
    /^left sun·sunn1$/,
  )
  // Unlabelled: no label element, and the header reads as before.
  for (const id of ['n2', 'n3', 'n0']) {
    await expect(cardLabel(page, id)).toHaveCount(0)
    await expect(graphNode(page, id).locator('.bloq-header')).not.toHaveClass(
      /labelled/,
    )
  }
  await expect(cardType(page, 'n2')).toHaveText('sun')
  await expect(graphNode(page, 'n2').locator('.bloq-header')).toHaveText(
    /^sunn2$/,
  )
  await expect(cardType(page, 'n0')).toHaveText('svg')
})

test("a label typed in the inspector shows beside the type on its card without changing the card's height", async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n0')
  const before = await cardHeight(page, 'n0')
  await labelField(page).pressSequentially('whole card')
  await expect(cardLabel(page, 'n0')).toHaveText('whole card')
  await expect(cardType(page, 'n0')).toHaveText('svg')
  await expect(inspectorHeader(page)).toContainText('whole card')
  const after = await cardHeight(page, 'n0')
  expect(after.style).toBe(before.style)
  expect(Math.abs(after.box - before.box)).toBeLessThan(0.5)
  // A long label is cut on the card, not wrapped onto a second line.
  await labelField(page).fill('a very long label that will not fit on the card')
  await expect(cardLabel(page, 'n0')).toHaveAttribute(
    'title',
    'a very long label that will not fit on the card',
  )
  expect((await cardHeight(page, 'n0')).style).toBe(before.style)
  // Blank text removes the label again.
  await labelField(page).fill('')
  await expect(cardLabel(page, 'n0')).toHaveCount(0)
})

test('undo and redo cover a label edit and typing in the Label field is one step', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n1')
  await labelField(page).pressSequentially('left')
  await expect(cardLabel(page, 'n1')).toHaveText('left')
  // Leave the field before undoing (never Ctrl+Z inside it: that would be
  // the browser's own undo). Leaving also ends the visit.
  await labelField(page).press('Tab')
  await expect(labelField(page)).not.toBeFocused()
  // One Undo takes back the whole word: the visit was one step.
  await button(page, 'Undo').click()
  await expect(cardLabel(page, 'n1')).toHaveCount(0)
  await expect(labelField(page)).toHaveValue('')
  await expect(button(page, 'Undo')).toBeDisabled()
  await button(page, 'Redo').click()
  await expect(cardLabel(page, 'n1')).toHaveText('left')
  await expect(labelField(page)).toHaveValue('left')
  // A second visit is a second step, a space typed mid-label included.
  await labelField(page).press('End')
  await labelField(page).pressSequentially(' sun')
  await expect(labelField(page)).toHaveValue('left sun')
  await expect(cardLabel(page, 'n1')).toHaveText('left sun')
  await labelField(page).press('Tab')
  await button(page, 'Undo').click()
  await expect(cardLabel(page, 'n1')).toHaveText('left')
  await expect(labelField(page)).toHaveValue('left')
  // Ctrl+Z with focus off any text field undoes the first visit too.
  await fitView(page)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(cardLabel(page, 'n1')).toHaveCount(0)
})

test("collapse suggests a name made from the node's label and the new instance keeps the label", async ({
  page,
  project,
}) => {
  addToCard(
    project,
    {
      n4: { type: 'g', label: 'Sun Group', children: ['n5'] },
      n5: { type: 'circle', params: { cx: 5, cy: 5, r: 3 } },
    },
    ['n4'],
  )
  await openCard(page, project, 4)
  await select(page, 'n4')
  await button(page, 'Collapse to component…').click()
  await expect(dialogOf(page).getByRole('textbox')).toHaveValue('sun-group')
  await answerName(page, 'sun-group')
  await fitView(page)
  await expect(cardType(page, 'n4')).toHaveText('sun-group')
  await expect(cardLabel(page, 'n4')).toHaveText('Sun Group')
  await expect(labelField(page)).toHaveValue('Sun Group')
  await expect(preview(page).locator('circle')).toHaveCount(4)
})

test('the Collapse dialog question and status line name a labelled node by its label and id', async ({
  page,
  project,
}) => {
  addToCard(
    project,
    {
      n4: { type: 'g', label: 'Sun Group', children: ['n5'] },
      n5: { type: 'circle', params: { cx: 5, cy: 5, r: 3 } },
      n6: { type: 'g', children: ['n7'] },
      n7: { type: 'circle', params: { cx: 9, cy: 9, r: 2 } },
    },
    ['n4', 'n6'],
  )
  await openCard(page, project, 5)
  await select(page, 'n4')
  await button(page, 'Collapse to component…').click()
  await expect(dialogOf(page)).toContainText(
    'Name for the component made from Sun Group (n4) and everything below it',
  )
  await answerName(page, 'sun-group')
  await expect(status(page)).toHaveText(
    'Collapsed Sun Group (n4) and 1 node below it into sun-group. Undo puts the nodes back; sun-group stays until you delete it.',
  )
  // An unlabelled node reads as before.
  await select(page, 'n6')
  await button(page, 'Collapse to component…').click()
  await expect(dialogOf(page)).toContainText(
    'Name for the component made from n6 and everything below it',
  )
  await expect(dialogOf(page).getByRole('textbox')).toHaveValue('sun-card-part')
  await answerName(page, 'sun-card-part')
  await expect(status(page)).toHaveText(
    'Collapsed n6 and 1 node below it into sun-card-part. Undo puts the nodes back; sun-card-part stays until you delete it.',
  )
})

test('the Make unique dialog question and status line name a labelled instance by its label and id', async ({
  page,
  project,
}) => {
  rewrite(project, 'sun-card', (spec) => {
    nodesOf(spec).n1.label = 'left sun'
  })
  await openCard(page, project)
  await select(page, 'n1')
  await button(page, 'Make unique…').click()
  await expect(dialogOf(page)).toContainText(
    "Name for left sun (n1)'s own copy of sun",
  )
  await answerName(page, 'sun-2')
  await expect(status(page)).toHaveText(
    'Copied sun to sun-2 for left sun (n1). Undo points left sun (n1) back at sun; sun-2 stays until you delete it.',
  )
  await fitView(page)
  await expect(cardLabel(page, 'n1')).toHaveText('left sun')
  await expect(cardType(page, 'n1')).toHaveText('sun-2')
  // An unlabelled instance reads as before.
  await select(page, 'n2')
  await button(page, 'Make unique…').click()
  await expect(dialogOf(page)).toContainText("Name for n2's own copy of sun")
  await answerName(page, 'sun-3')
  await expect(status(page)).toHaveText(
    'Copied sun to sun-3 for n2. Undo points n2 back at sun; sun-3 stays until you delete it.',
  )
})

test('a problem on a labelled node is named by its label with its id in the problems list', async ({
  page,
  project,
}) => {
  addToCard(project, {
    n4: { type: 'circle', label: 'bad dot', params: { r: 'missingThing' } },
    n5: { type: 'circle', params: { r: 'alsoMissing' } },
  })
  await openCard(page, project, null)
  const items = problemsList(page).locator('li')
  await expect(
    items.filter({ hasText: 'missingThing' }).filter({ hasNotText: 'also' }),
  ).toContainText('sun-card · bad dot (n4).r')
  await expect(items.filter({ hasText: 'alsoMissing' })).toContainText(
    'sun-card · n5.r',
  )
  // Label it in the inspector: the list follows.
  await select(page, 'n5')
  await labelField(page).fill('other dot')
  await expect(items.filter({ hasText: 'alsoMissing' })).toContainText(
    'sun-card · other dot (n5).r',
  )
})

test('the inspector lists problems inside a definition by the label of the node they are on, with its id', async ({
  page,
  project,
}) => {
  write(project, 'part', {
    format: 'hackensack/4',
    id: 'aa11bb22',
    root: 'p0',
    nodes: {
      p0: { type: 'g', children: ['p1', 'p2'] },
      p1: { type: 'circle', label: 'bad dot', params: { r: 'missingThing' } },
      p2: { type: 'circle', params: { r: 'alsoMissing' } },
    },
  })
  addToCard(project, { n4: { type: 'component', ref: 'aa11bb22' } })
  await openCard(page, project, null)
  await select(page, 'n4')
  const inside = page
    .locator('.inspector-section', { hasText: 'Problems inside part' })
    .locator('li')
  await expect(
    inside.filter({ hasText: 'missingThing' }).first(),
  ).toContainText('part via n4 · bad dot (p1).r')
  await expect(inside.filter({ hasText: 'alsoMissing' })).toContainText(
    'part via n4 · p2.r',
  )
})

test("the windmill's parts show their labels as card titles in the editor", async ({
  page,
  project,
}) => {
  await openWindmill(page, project)
  await fitView(page)
  await expect(page.locator('.react-flow__node')).toHaveCount(14)
  await expect(page.locator('.react-flow__node .bloq-label')).toHaveCount(14)
  await expect(cardLabel(page, 'w8')).toHaveText('cloud')
  await expect(cardType(page, 'w8')).toHaveText('ellipse')
  await expect(cardLabel(page, 'w7')).toHaveText('sails')
  await expect(cardType(page, 'w7')).toHaveText('rotor')
  await expect(cardLabel(page, 'w3')).toHaveText('tower')
  await expect(cardLabel(page, 'w13')).toHaveText('sun radius')
  // Inside the rotor, its blades are labelled too.
  await graphNode(page, 'w7').dblclick()
  await fitView(page)
  await expect(cardLabel(page, 'r2')).toHaveText('blade 1')
  await expect(cardLabel(page, 'r5')).toHaveText('hub')
})

test('find node lists matches by label or type and picking one brings that node into view and selects it', async ({
  page,
  project,
}) => {
  await openWindmill(page, project)
  await fitView(page)
  // Zoom in, so most of the graph is out of view.
  for (let i = 0; i < 4; i++)
    await page.locator('.react-flow__controls-zoomin').click()
  // By label.
  await findBox(page).fill('CLOUD')
  await expect(matches(page)).toHaveText(['cloud · ellipse (w8)'])
  // By type: both ellipses, label first.
  await findBox(page).fill('ellipse')
  await expect(matches(page)).toHaveText([
    'cloud · ellipse (w8)',
    'raindrop · ellipse (w11)',
  ])
  expect(await offCentre(page, 'w11')).toBeGreaterThan(60)
  await matches(page).nth(1).click()
  // Picked: the box clears, the view is centred on it, and it is selected.
  await expect(findBox(page)).toHaveValue('')
  await expect(matches(page)).toHaveCount(0)
  await expect(graphNode(page, 'w11')).toHaveClass(/selected/)
  await expect(inspectorHeader(page)).toContainText('w11')
  await expect(labelField(page)).toHaveValue('raindrop')
  expect(await offCentre(page, 'w11')).toBeLessThan(20)
  // Enter picks the first match; an instance is found by its component.
  await findBox(page).fill('rotor')
  await expect(matches(page).first()).toHaveText('rotor mount · g (w6)')
  await expect(matches(page)).toHaveText([
    'rotor mount · g (w6)',
    'sails · rotor (w7)',
  ])
  await findBox(page).press('ArrowDown')
  await findBox(page).press('Enter')
  await expect(inspectorHeader(page)).toContainText('w7')
  expect(await offCentre(page, 'w7')).toBeLessThan(20)
  // Nothing matches: says so.
  await findBox(page).fill('zebra')
  await expect(page.locator('.graph-find-none')).toHaveText('No node matches.')
})

test('find node searches only the component being edited', async ({
  page,
  project,
}) => {
  await openWindmill(page, project)
  // The rotor's blades and hub are inside its definition, not the windmill.
  await findBox(page).fill('blade')
  await expect(matches(page)).toHaveCount(0)
  await expect(page.locator('.graph-find-none')).toHaveText('No node matches.')
  await findBox(page).fill('hub')
  await expect(page.locator('.graph-find-none')).toBeVisible()
  await findBox(page).fill('')
  // Inside the rotor, they are found, and the windmill's nodes aren't.
  await fitView(page)
  await graphNode(page, 'w7').dblclick()
  await expect(graphNode(page, 'r5')).toBeVisible()
  await findBox(page).fill('blade')
  await expect(matches(page)).toHaveText([
    'blades · g (r0)',
    'blade 1 · path (r2)',
    'blade 2 · path (r3)',
    'blade 3 · path (r4)',
  ])
  await findBox(page).fill('cloud')
  await expect(matches(page)).toHaveCount(0)
  await findBox(page).fill('hub')
  await matches(page).first().click()
  await expect(inspectorHeader(page)).toContainText('r5')
})
