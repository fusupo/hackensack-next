// Make unique (#13): give one instance its own copy of its definition. Each
// test seeds its own copy of the sun-card example: `sun-card` draws three
// `sun` instances, n1, n2 and n3 (radius 10, 20 and 40). Every test is a
// top-level `test`, so the validation contract selects it as
// `e2e/make-unique.spec.ts::<title>`.

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

const preview = (page: Page) => page.getByTestId('preview')
const graphNode = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`)
const fitView = (page: Page) =>
  page.locator('.react-flow__controls-fitview').click()
const inspectorHeader = (page: Page) => page.locator('.inspector-header')
const makeUniqueButton = (page: Page) =>
  page.getByRole('button', { name: 'Make unique…', exact: true })
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
/** A param field in the inspector, by its label (start from page: see lore). */
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true })

/** Open the seeded project on sun-card (it opens on sun, the first by name). */
async function openCard(page: Page, project: SeededProject, circles = 3) {
  await openProject(page, project)
  await pickComponent(page, 'sun-card')
  await expect(preview(page).locator('circle')).toHaveCount(circles)
}

/** Select a node by clicking its card's header. */
async function select(page: Page, id: string) {
  await fitView(page)
  await graphNode(page, id).locator('.bloq-header').click()
  await expect(inspectorHeader(page)).toContainText(id)
}

/** Make the selected instance unique, accepting the suggested name. */
async function makeUnique(page: Page, id: string, name: string) {
  await select(page, id)
  await makeUniqueButton(page).click()
  await expect(nameField(page)).toHaveValue(name)
  await answerName(page, name)
}

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

/** The spec's nodes, as plain records. */
const nodesOf = (spec: Record<string, unknown>) =>
  spec.nodes as Record<string, Record<string, unknown>>

test('make unique is offered on an instance, disabled for a sole use and hidden on an example', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n1')
  await expect(makeUniqueButton(page)).toBeEnabled()

  // After n1 and n2 get copies of their own, n3 is sun's only use.
  await makeUnique(page, 'n1', 'sun-2')
  await makeUnique(page, 'n2', 'sun-3')
  await select(page, 'n3')
  await expect(makeUniqueButton(page)).toBeDisabled()
  await expect(makeUniqueButton(page)).toHaveAttribute(
    'title',
    'Only this instance uses sun',
  )
  await expect(page.getByText('Only this instance uses sun.')).toBeVisible()
  // A copy is its instance's only use too.
  await select(page, 'n1')
  await expect(makeUniqueButton(page)).toBeDisabled()
  await expect(makeUniqueButton(page)).toHaveAttribute(
    'title',
    'Only this instance uses sun-2',
  )

  // Examples are read-only: no button at all.
  await projectMenu(page).selectOption('examples/sun-card')
  await pickComponent(page, 'sun-card')
  await select(page, 'n1')
  await expect(definition(page)).toHaveText('sun')
  await expect(makeUniqueButton(page)).toHaveCount(0)
})

test('make unique is hidden for an instance with no definition or a missing one', async ({
  page,
  project,
}) => {
  rewrite(project, 'sun-card', (spec) => {
    delete nodesOf(spec).n1!.ref
    nodesOf(spec).n2!.ref = 'deadbeef'
  })
  await openCard(page, project, 1)

  await select(page, 'n1')
  await expect(page.locator('#ref')).toBeVisible()
  await expect(makeUniqueButton(page)).toHaveCount(0)
  await select(page, 'n2')
  await expect(definition(page)).toHaveText('missing component')
  await expect(makeUniqueButton(page)).toHaveCount(0)
  // n3 still uses sun, now its only use: shown, but disabled.
  await select(page, 'n3')
  await expect(makeUniqueButton(page)).toBeDisabled()
})

test('make unique dialog suggests sun-2 and blocks a taken or an invalid name', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await select(page, 'n1')
  await makeUniqueButton(page).click()
  await expect(dialogOf(page)).toContainText("Name for n1's own copy of sun")
  await expect(nameField(page)).toHaveValue('sun-2')
  await expect(problem(page)).toHaveText('')
  await expect(okButton(page)).toBeEnabled()

  await nameField(page).fill('sun-card')
  await expect(problem(page)).toHaveText(
    'There is already a component named "sun-card".',
  )
  await expect(okButton(page)).toBeDisabled()
  await nameField(page).fill('bad name')
  await expect(problem(page)).toContainText(`"bad name" isn't a valid name`)
  await expect(okButton(page)).toBeDisabled()
  await nameField(page).fill('sunny')
  await expect(problem(page)).toHaveText('')
  await expect(okButton(page)).toBeEnabled()

  // Cancel changes nothing.
  await cancelButton(page).click()
  await expect(dialogOf(page)).toHaveCount(0)
  expect(await componentOptions(page)).toEqual(['sun (3)', 'sun-card'])

  // With sun-2 taken, the next suggestion is sun-3.
  await makeUnique(page, 'n1', 'sun-2')
  await select(page, 'n2')
  await makeUniqueButton(page).click()
  await expect(nameField(page)).toHaveValue('sun-3')
  await cancelButton(page).click()
})

test('makes one instance unique and leaves the others on the original', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  await makeUnique(page, 'n1', 'sun-2')

  // The view stays on sun-card with n1 selected, now using its copy.
  await expect(inspectorHeader(page)).toContainText('n1')
  await expect(definition(page)).toHaveText('sun-2')
  await expect(usedIn(page)).toHaveText('Used in · 1 instance')
  await expect(status(page)).toHaveText(
    'Copied sun to sun-2 for n1. Undo points n1 back at sun; sun-2 stays until you delete it.',
  )
  await expect(graphNode(page, 'n1').locator('.bloq-type')).toHaveText('sun-2')
  for (const id of ['n2', 'n3'])
    await expect(graphNode(page, id).locator('.bloq-type')).toHaveText('sun')
  expect(await componentOptions(page)).toEqual([
    'sun (2)',
    'sun-2 (1) •',
    'sun-card •',
  ])
  // The copy draws the same sun, with n1's own bindings kept.
  await expect(preview(page).locator('circle')).toHaveCount(3)
  await expect(field(page, 'radius')).toHaveValue('10')

  // The other instances still use sun.
  await select(page, 'n2')
  await expect(definition(page)).toHaveText('sun')
  await expect(usedIn(page)).toHaveText('Used in · 2 instances')
})

test('saves the unique copy and the repointed parent', async ({
  page,
  project,
}) => {
  const sunBefore = project.json('components/sun.json')
  const sampleBefore = project.json('samples/sun.data.json')
  await openCard(page, project)
  await makeUnique(page, 'n1', 'sun-2')

  // sun-card, the copy and its sample: three files to write, none to delete.
  await expect(saveButton(page)).toHaveText('Save (3)')
  expect(project.has('components/sun-2.json')).toBe(false)
  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')

  const copy = project.json('components/sun-2.json')
  expect(copy.id).not.toBe(sunBefore.id)
  expect({ ...copy, id: sunBefore.id }).toEqual(sunBefore)
  expect(project.json('samples/sun-2.data.json')).toEqual(sampleBefore)
  expect(project.json('components/sun.json')).toEqual(sunBefore)
  const card = nodesOf(project.json('components/sun-card.json'))
  expect(card.n1).toEqual({
    type: 'component',
    ref: copy.id,
    params: { radius: 10, x: 40, y: 70 },
  })
  expect(card.n2!.ref).toBe(sunBefore.id)
  expect(card.n3!.ref).toBe(sunBefore.id)
})

test('undo after make unique points the instance back at the original and redo at the copy', async ({
  page,
  project,
}) => {
  await openCard(page, project)
  // An earlier edit to sun-card, which must stay undoable.
  await select(page, 'n2')
  await field(page, 'radius').fill('25')
  await page.locator('h1').click()
  await makeUnique(page, 'n1', 'sun-2')
  await expect(definition(page)).toHaveText('sun-2')

  await button(page, 'Undo').click()
  await expect(inspectorHeader(page)).toContainText('n1')
  await expect(definition(page)).toHaveText('sun')
  // The copy stays, unused and unsaved.
  expect(await componentOptions(page)).toEqual([
    'sun (3)',
    'sun-2 •',
    'sun-card •',
  ])
  // The edit before Make unique undoes too.
  await button(page, 'Undo').click()
  await select(page, 'n2')
  await expect(field(page, 'radius')).toHaveValue('20')

  await button(page, 'Redo').click()
  await expect(field(page, 'radius')).toHaveValue('25')
  await button(page, 'Redo').click()
  await select(page, 'n1')
  await expect(definition(page)).toHaveText('sun-2')
  expect(await componentOptions(page)).toEqual([
    'sun (2)',
    'sun-2 (1) •',
    'sun-card •',
  ])
})

test('make unique inside an entered definition keeps the breadcrumbs and opens the copy', async ({
  page,
  project,
}) => {
  // deck draws one sun-card; sun-card's suns are entered through it.
  const cardId = project.json('components/sun-card.json').id as string
  writeFileSync(
    join(project.dir, 'components/deck.json'),
    JSON.stringify({
      format: 'hackensack/4',
      id: 'e2e0deck',
      root: 'n0',
      nodes: {
        n0: {
          type: 'svg',
          params: { width: 320, height: 140 },
          children: ['n1'],
        },
        n1: { type: 'component', ref: cardId },
      },
    }),
  )
  await openProject(page, project)
  await pickComponent(page, 'deck')
  await expect(preview(page).locator('circle')).toHaveCount(3)
  await fitView(page)
  await graphNode(page, 'n1').dblclick()
  await expect(trailNav(page).locator('.breadcrumb-current')).toHaveText(
    'sun-card',
  )

  await makeUnique(page, 'n1', 'sun-2')
  await expect(definition(page)).toHaveText('sun-2')
  // The trail is just as it was.
  await expect(trailNav(page).locator('.breadcrumb')).toHaveText(['deck'])
  await expect(trailNav(page).locator('.breadcrumb-current')).toHaveText(
    'sun-card',
  )

  // Entering the instance now opens the copy.
  await fitView(page)
  await graphNode(page, 'n1').dblclick()
  await expect(trailNav(page).locator('.breadcrumb')).toHaveText([
    'deck',
    'sun-card',
  ])
  await expect(trailNav(page).locator('.breadcrumb-current')).toHaveText(
    'sun-2',
  )
})
