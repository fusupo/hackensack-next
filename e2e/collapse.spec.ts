// Collapse to component (#14): turn a node and everything below it into a new
// definition, with one instance of it in the node's place. Each test seeds
// its own copy of the sun-card example plus a `deck` component: an each over
// `items` (n1) holding a group n2 that draws a circle n3 and a rect n4, and
// a loose group n9 holding a circle n10. Every test is a top-level `test`,
// so the validation contract selects it as `e2e/collapse.spec.ts::<title>`.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  answerName,
  componentOptions,
  dialogOf,
  expect,
  openProject,
  pickComponent,
  projectMenu,
  saveButton,
  test,
} from './fixtures.ts'
import type { SeededProject } from './fixtures.ts'

const DECK_ID = 'de0c0001'

const preview = (page: Page) => page.getByTestId('preview')
const graphNode = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`)
const fitView = (page: Page) =>
  page.locator('.react-flow__controls-fitview').click()
const inspectorHeader = (page: Page) => page.locator('.inspector-header')
const collapseButton = (page: Page) =>
  page.getByRole('button', { name: 'Collapse to component…', exact: true })
const collapseHint = (page: Page) => page.locator('.collapse-node .placeholder')
/** The Definition select's chosen option: the instance's definition by name. */
const definition = (page: Page) => page.locator('#ref option:checked')
const usedIn = (page: Page) =>
  page.locator('.inspector-section h3', { hasText: 'Used in' })
/** The status line (not the problems panel, which is also a status). */
const status = (page: Page) => page.locator('.status')
const nameField = (page: Page) => dialogOf(page).getByRole('textbox')
const problem = (page: Page) => dialogOf(page).getByRole('alert')
const okButton = (page: Page) =>
  dialogOf(page).getByRole('button', { name: 'OK', exact: true })
const cancelButton = (page: Page) =>
  dialogOf(page).getByRole('button', { name: 'Cancel', exact: true })
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const trailNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Component trail' })
/** A param or binding field in the inspector, by its label (from page: see lore). */
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true })
/** The drawn picture's markup. */
const picture = (page: Page) => preview(page).locator('svg').first()

/** Write deck (and its sample) into the seeded project before it is opened. */
function seedDeck(project: SeededProject) {
  writeFileSync(
    join(project.dir, 'components/deck.json'),
    JSON.stringify(
      {
        format: 'hackensack/3',
        id: DECK_ID,
        inputs: {
          items: { type: 'list' },
          color: { type: 'string', default: '#336699' },
        },
        root: 'n0',
        nodes: {
          n0: {
            type: 'svg',
            params: { width: 160, height: 100 },
            children: ['n1'],
          },
          n1: { type: 'each', params: { list: 'items' }, children: ['n2'] },
          n2: {
            type: 'g',
            params: { transform: 'translate(i * 40 + 20, 50)' },
            children: ['n3', 'n4'],
          },
          n3: { type: 'circle', params: { r: 'd', fill: '=color' } },
          n4: { type: 'rect', params: { width: 'd * 2', height: 4 } },
          n9: { type: 'g', children: ['n10'] },
          n10: { type: 'circle', params: { r: 5, fill: '=color' } },
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(project.dir, 'samples/deck.data.json'),
    JSON.stringify({ items: [5, 10, 15] }),
  )
}

/** Open the seeded project on deck. */
async function openDeck(page: Page, project: SeededProject) {
  seedDeck(project)
  await openProject(page, project)
  await pickComponent(page, 'deck')
  await expect(preview(page).locator('circle')).toHaveCount(3)
}

/** Select a node by clicking its card's header. */
async function select(page: Page, id: string) {
  await fitView(page)
  await graphNode(page, id).locator('.bloq-header').click()
  await expect(inspectorHeader(page)).toContainText(id)
}

/** Collapse a node, checking the dialog's suggestion, and accept it. */
async function collapse(page: Page, id: string, name: string) {
  await select(page, id)
  await collapseButton(page).click()
  await expect(nameField(page)).toHaveValue(name)
  await answerName(page, name)
}

const statusText = (what: string, name: string) =>
  `Collapsed ${what} into ${name}. Undo puts the nodes back; ${name} stays until you delete it.`

test('collapse is offered on a subtree and a loose node, disabled with a hint for the root and a lone instance, and hidden on an example', async ({
  page,
  project,
}) => {
  await openDeck(page, project)
  for (const id of ['n2', 'n9', 'n3']) {
    await select(page, id)
    await expect(collapseButton(page)).toBeEnabled()
    await expect(collapseHint(page)).toHaveCount(0)
  }

  await select(page, 'n0')
  await expect(collapseButton(page)).toBeDisabled()
  await expect(collapseHint(page)).toHaveText(
    'The root is the whole component; use Duplicate to copy it.',
  )

  // sun-card's suns are instances already.
  await pickComponent(page, 'sun-card')
  await select(page, 'n1')
  await expect(collapseButton(page)).toBeDisabled()
  await expect(collapseHint(page)).toHaveText(
    'It is already an instance of a component.',
  )

  // Examples are read-only: no button at all.
  await projectMenu(page).selectOption('examples/sun-card')
  await pickComponent(page, 'sun-card')
  await select(page, 'n1')
  await expect(definition(page)).toHaveText('sun')
  await expect(collapseButton(page)).toHaveCount(0)
})

test('collapse dialog suggests deck-part and blocks a taken or an invalid name', async ({
  page,
  project,
}) => {
  await openDeck(page, project)
  await select(page, 'n2')
  await collapseButton(page).click()
  await expect(dialogOf(page)).toContainText(
    'Name for the component made from n2 and everything below it',
  )
  await expect(nameField(page)).toHaveValue('deck-part')
  await expect(problem(page)).toHaveText('')
  await expect(okButton(page)).toBeEnabled()

  await nameField(page).fill('deck')
  await expect(problem(page)).toHaveText(
    'There is already a component named "deck".',
  )
  await expect(okButton(page)).toBeDisabled()
  await nameField(page).fill('bad name')
  await expect(problem(page)).toContainText(`"bad name" isn't a valid name`)
  await expect(okButton(page)).toBeDisabled()
  await nameField(page).fill('row')
  await expect(problem(page)).toHaveText('')
  await expect(okButton(page)).toBeEnabled()

  // Cancel changes nothing.
  await cancelButton(page).click()
  await expect(dialogOf(page)).toHaveCount(0)
  expect(await componentOptions(page)).toEqual(['deck', 'sun (3)', 'sun-card'])
  await expect(graphNode(page, 'n3')).toHaveCount(1)
})

test('collapses a subtree into a component whose inputs are the variables it used and draws the same picture', async ({
  page,
  project,
}) => {
  await openDeck(page, project)
  const before = await picture(page).evaluate((svg) => svg.outerHTML)
  await collapse(page, 'n2', 'deck-part')

  // n2 is an instance now, binding each new input to the variable it used.
  await expect(definition(page)).toHaveText('deck-part')
  await expect(field(page, 'i')).toHaveValue('i')
  await expect(field(page, 'd')).toHaveValue('d')
  await expect(field(page, 'color')).toHaveValue('=color')
  await expect(graphNode(page, 'n3')).toHaveCount(0)
  await expect(graphNode(page, 'n4')).toHaveCount(0)
  await expect(graphNode(page, 'n2').locator('.bloq-type')).toHaveText(
    'deck-part',
  )

  // The picture is exactly the same, with no problems.
  await expect(preview(page).locator('circle')).toHaveCount(3)
  expect(await picture(page).evaluate((svg) => svg.outerHTML)).toBe(before)
  await expect(page.locator('.problem-list li')).toHaveCount(0)
})

test('after collapse the instance stays selected, shows the new definition and opens it with its inputs', async ({
  page,
  project,
}) => {
  await openDeck(page, project)
  await collapse(page, 'n2', 'deck-part')

  // The view stays on deck with the instance, n2, selected.
  await expect(trailNav(page).locator('.breadcrumb-current')).toHaveText('deck')
  await expect(inspectorHeader(page)).toContainText('n2')
  await expect(inspectorHeader(page)).toContainText('deck-part')
  await expect(definition(page)).toHaveText('deck-part')
  await expect(usedIn(page)).toHaveText('Used in · 1 instance')
  await expect(status(page)).toHaveText(
    statusText('n2 and 2 nodes below it', 'deck-part'),
  )
  expect(await componentOptions(page)).toEqual([
    'deck •',
    'deck-part (1) •',
    'sun (3)',
    'sun-card',
  ])
  await expect(field(page, 'i')).toHaveValue('i')
  await expect(field(page, 'd')).toHaveValue('d')
  await expect(field(page, 'color')).toHaveValue('=color')

  // Entering it shows its inputs and the nodes that were collapsed.
  await fitView(page)
  await graphNode(page, 'n2').dblclick()
  await expect(trailNav(page).locator('.breadcrumb')).toHaveText(['deck'])
  await expect(trailNav(page).locator('.breadcrumb-current')).toHaveText(
    'deck-part',
  )
  const inputNames = page.getByLabel('Input name', { exact: true })
  await expect(inputNames).toHaveCount(3)
  expect(
    await inputNames.evaluateAll((els) =>
      els.map((el) => (el as HTMLInputElement).value),
    ),
  ).toEqual(['i', 'd', 'color'])
  await expect(page.getByLabel('Type of color', { exact: true })).toHaveValue(
    'string',
  )
  await expect(page.getByLabel('Type of i', { exact: true })).toHaveValue('any')
  for (const id of ['n2', 'n3', 'n4'])
    await expect(graphNode(page, id)).toHaveCount(1)
  await expect(graphNode(page, 'n0')).toHaveCount(0)
})

test('collapse status line says how many nodes went with the node: one, then none', async ({
  page,
  project,
}) => {
  await openDeck(page, project)
  // The loose group n9 and its circle n10.
  await collapse(page, 'n9', 'deck-part')
  await expect(status(page)).toHaveText(
    statusText('n9 and 1 node below it', 'deck-part'),
  )
  await expect(definition(page)).toHaveText('deck-part')
  await expect(field(page, 'color')).toHaveValue('=color')
  await expect(graphNode(page, 'n10')).toHaveCount(0)

  // A leaf: nothing below it.
  await collapse(page, 'n3', 'deck-part-2')
  await expect(status(page)).toHaveText(statusText('n3', 'deck-part-2'))
  await expect(definition(page)).toHaveText('deck-part-2')
  await expect(preview(page).locator('circle')).toHaveCount(3)
})

test('undo after collapse puts the nodes back and leaves the new component unused, and redo collapses again', async ({
  page,
  project,
}) => {
  await openDeck(page, project)
  // An earlier edit to deck, which must stay undoable.
  await select(page, 'n4')
  await field(page, 'height').fill('6')
  await page.locator('h1').click()
  await collapse(page, 'n2', 'deck-part')
  await expect(graphNode(page, 'n3')).toHaveCount(0)

  await button(page, 'Undo').click()
  for (const id of ['n3', 'n4'])
    await expect(graphNode(page, id)).toHaveCount(1)
  await expect(graphNode(page, 'n2').locator('.bloq-type')).toHaveText('g')
  // The new component stays, unused and unsaved.
  expect(await componentOptions(page)).toEqual([
    'deck •',
    'deck-part •',
    'sun (3)',
    'sun-card',
  ])
  // The edit before the collapse undoes too.
  await button(page, 'Undo').click()
  await select(page, 'n4')
  await expect(field(page, 'height')).toHaveValue('4')

  await button(page, 'Redo').click()
  await expect(field(page, 'height')).toHaveValue('6')
  await button(page, 'Redo').click()
  await expect(graphNode(page, 'n3')).toHaveCount(0)
  await expect(graphNode(page, 'n4')).toHaveCount(0)
  await select(page, 'n2')
  await expect(definition(page)).toHaveText('deck-part')
  expect(await componentOptions(page)).toEqual([
    'deck •',
    'deck-part (1) •',
    'sun (3)',
    'sun-card',
  ])
})

test('saves the collapsed component and the changed parent', async ({
  page,
  project,
}) => {
  await openDeck(page, project)
  await collapse(page, 'n2', 'deck-part')

  // deck, the new component and its sample: three files, none to delete.
  await expect(saveButton(page)).toHaveText('Save (3)')
  expect(project.has('components/deck-part.json')).toBe(false)
  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')

  const part = project.json('components/deck-part.json')
  const partNodes = part.nodes as Record<string, Record<string, unknown>>
  expect(part.root).toBe('n2')
  expect(Object.keys(partNodes).sort()).toEqual(['n2', 'n3', 'n4'])
  expect(part.inputs).toEqual({
    i: { type: 'any' },
    d: { type: 'any' },
    color: { type: 'string' },
  })
  const deck = project.json('components/deck.json')
  const deckNodes = deck.nodes as Record<string, Record<string, unknown>>
  expect(deckNodes.n3).toBeUndefined()
  expect(deckNodes.n4).toBeUndefined()
  expect(deckNodes.n2).toEqual({
    type: 'component',
    ref: part.id,
    params: { i: 'i', d: 'd', color: '=color' },
  })
  expect(deckNodes.n1!.children).toEqual(['n2'])
  // color takes deck's default (deck's sample sets only items); i and d are
  // loop variables and get nothing.
  expect(project.json('samples/deck-part.data.json')).toEqual({
    color: '#336699',
  })
  expect(project.json('samples/deck.data.json')).toEqual({ items: [5, 10, 15] })
})

test('collapse inside an entered definition keeps the breadcrumbs', async ({
  page,
  project,
}) => {
  seedDeck(project)
  // stage draws one deck; deck's nodes are reached by entering it.
  writeFileSync(
    join(project.dir, 'components/stage.json'),
    JSON.stringify({
      format: 'hackensack/3',
      id: 'e2e0stag',
      root: 'n0',
      nodes: {
        n0: {
          type: 'svg',
          params: { width: 160, height: 100 },
          children: ['n1'],
        },
        n1: { type: 'component', ref: DECK_ID, params: { items: '[4, 8]' } },
      },
    }),
  )
  await openProject(page, project)
  await pickComponent(page, 'stage')
  await expect(preview(page).locator('circle')).toHaveCount(2)
  await fitView(page)
  await graphNode(page, 'n1').dblclick()
  await expect(trailNav(page).locator('.breadcrumb-current')).toHaveText('deck')

  await collapse(page, 'n2', 'deck-part')
  await expect(definition(page)).toHaveText('deck-part')
  // The trail is just as it was.
  await expect(trailNav(page).locator('.breadcrumb')).toHaveText(['stage'])
  await expect(trailNav(page).locator('.breadcrumb-current')).toHaveText('deck')
  expect(await componentOptions(page)).toContain('deck-part (1) •')
  await expect(preview(page).locator('circle')).toHaveCount(2)
})
