// The editor's in-app dialogs (#12): names checked as you type, and delete
// confirmations, in place of the browser's own dialogs. Each test seeds its
// own saved copy of the sun-card example, which opens on `sun` (drawn three
// times by `sun-card`). Every test is a top-level `test`, so the validation
// contract selects it as `e2e/dialogs.spec.ts::<title>`.

import { existsSync } from 'node:fs'
import type { Page } from '@playwright/test'
import {
  answerConfirm,
  componentMenu,
  componentOptions,
  dialogOf,
  expect,
  openProject,
  projectMenu,
  saveButton,
  test,
} from './fixtures.ts'

const nameField = (page: Page) => dialogOf(page).getByRole('textbox')
const problem = (page: Page) => dialogOf(page).getByRole('alert')
const okButton = (page: Page) =>
  dialogOf(page).getByRole('button', { name: 'OK', exact: true })
const cancelButton = (page: Page) =>
  dialogOf(page).getByRole('button', { name: 'Cancel', exact: true })
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const undoButton = (page: Page) => button(page, 'Undo')
/** The status line (not the problems panel, which is also a status). */
const status = (page: Page) => page.locator('.status')
/** The `sun` component's radius input default, in the inspector. */
const radiusDefault = (page: Page) => page.getByLabel('Default for radius')
const xDefault = (page: Page) => page.getByLabel('Default for x')

/** Click somewhere neutral, so the focused field loses focus. */
async function leaveField(page: Page) {
  await page.locator('h1').click()
}

/** The selected range of the dialog's name field. */
async function selection(page: Page) {
  return nameField(page).evaluate((input) => {
    const field = input as HTMLInputElement
    return [field.selectionStart, field.selectionEnd]
  })
}

test('new project dialog validates as you type and creates the project on Enter', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await button(page, 'New project').click()

  await expect(dialogOf(page)).toContainText('Name for the new project')
  await expect(nameField(page)).toHaveValue('')
  // Nothing typed yet: nothing to point out, but nothing to accept either.
  await expect(problem(page)).toHaveText('')
  await expect(okButton(page)).toBeDisabled()

  await nameField(page).fill('a b')
  await expect(problem(page)).toContainText(`"a b" isn't a valid name`)
  await expect(okButton(page)).toBeDisabled()

  await nameField(page).fill(project.name)
  await expect(problem(page)).toHaveText(
    `There is already a project named "${project.name}".`,
  )
  await expect(okButton(page)).toBeDisabled()

  await nameField(page).fill('')
  await expect(problem(page)).toHaveText('Enter a name.')
  await expect(okButton(page)).toBeDisabled()

  const name = `${project.name}-new`
  await nameField(page).fill(name)
  await expect(problem(page)).toHaveText('')
  await expect(okButton(page)).toBeEnabled()
  await nameField(page).press('Enter')

  await expect(dialogOf(page)).toHaveCount(0)
  await expect(projectMenu(page)).toHaveValue(`projects/${name}`)
})

test('name dialog opens focused with the suggestion selected and asks the same question', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await expect(componentMenu(page)).toHaveValue('sun')
  await button(page, 'Rename component…').click()

  await expect(dialogOf(page)).toContainText('New name for sun')
  await expect(nameField(page)).toBeFocused()
  await expect(nameField(page)).toHaveValue('sun')
  expect(await selection(page)).toEqual([0, 3])

  // Typing replaces the selected suggestion.
  await page.keyboard.type('star')
  await expect(nameField(page)).toHaveValue('star')
  await cancelButton(page).click()
  await expect(dialogOf(page)).toHaveCount(0)
  await expect(componentMenu(page)).toHaveValue('sun')
})

test('duplicate to edit on an example opens the dialog with the example name pre-filled and free', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await projectMenu(page).selectOption('examples/sun-card')
  await button(page, 'Duplicate to edit…').click()

  await expect(dialogOf(page)).toContainText('Name for the new project')
  await expect(nameField(page)).toBeFocused()
  await expect(nameField(page)).toHaveValue('sun-card')
  expect(await selection(page)).toEqual([0, 'sun-card'.length])
  await expect(problem(page)).toHaveText('')
  await expect(okButton(page)).toBeEnabled()

  await nameField(page).press('Enter')
  await expect(dialogOf(page)).toHaveCount(0)
  await expect(projectMenu(page)).toHaveValue('projects/sun-card')
})

test('duplicate project dialog starts on a taken name and blocks OK until it changes', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await button(page, 'Duplicate project…').click()

  await expect(dialogOf(page)).toContainText('Name for the new project')
  await expect(nameField(page)).toHaveValue(project.name)
  // The suggestion is the project's own name, so it is taken from the start.
  await expect(problem(page)).toHaveText(
    `There is already a project named "${project.name}".`,
  )
  await expect(okButton(page)).toBeDisabled()

  const name = `${project.name}-copy`
  await nameField(page).fill(name)
  await expect(problem(page)).toHaveText('')
  await expect(okButton(page)).toBeEnabled()
  await okButton(page).click()

  await expect(dialogOf(page)).toHaveCount(0)
  await expect(projectMenu(page)).toHaveValue(`projects/${name}`)
})

test('new component dialog reports a taken name and blocks OK', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await button(page, 'New component').click()

  await expect(dialogOf(page)).toContainText('Name for the new component')
  await expect(nameField(page)).toBeFocused()
  await nameField(page).fill('sun')
  await expect(problem(page)).toHaveText(
    'There is already a component named "sun".',
  )
  await expect(okButton(page)).toBeDisabled()
  // Enter on a taken name does nothing.
  await nameField(page).press('Enter')
  await expect(dialogOf(page)).toBeVisible()

  await nameField(page).fill('moon')
  await expect(okButton(page)).toBeEnabled()
  await okButton(page).click()
  await expect(dialogOf(page)).toHaveCount(0)
  await expect.poll(() => componentOptions(page)).toContain('moon •')
  await expect(componentMenu(page)).toHaveValue('moon')
})

test('Escape and Cancel close a name dialog without changing anything', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  const before = await componentOptions(page)

  await button(page, 'New component').click()
  await nameField(page).fill('moon')
  await page.keyboard.press('Escape')
  await expect(dialogOf(page)).toHaveCount(0)
  await expect(saveButton(page)).toHaveText('Saved')
  expect(await componentOptions(page)).toEqual(before)

  await button(page, 'Rename component…').click()
  await nameField(page).fill('star')
  await cancelButton(page).click()
  await expect(dialogOf(page)).toHaveCount(0)
  await expect(saveButton(page)).toHaveText('Saved')
  await expect(componentMenu(page)).toHaveValue('sun')
  expect(await componentOptions(page)).toEqual(before)

  await button(page, 'Rename project…').click()
  await nameField(page).fill(`${project.name}-renamed`)
  await page.keyboard.press('Escape')
  await expect(dialogOf(page)).toHaveCount(0)
  await expect(projectMenu(page)).toHaveValue(project.key)
  expect(existsSync(project.dir)).toBe(true)
})

test('rename component dialog accepts the unchanged name as a no-op', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  const before = await componentOptions(page)
  await button(page, 'Rename component…').click()

  await expect(nameField(page)).toHaveValue('sun')
  // Its own name isn't "taken".
  await expect(problem(page)).toHaveText('')
  await expect(okButton(page)).toBeEnabled()
  await okButton(page).click()

  await expect(dialogOf(page)).toHaveCount(0)
  await expect(componentMenu(page)).toHaveValue('sun')
  await expect(saveButton(page)).toHaveText('Saved')
  expect(await componentOptions(page)).toEqual(before)
  await expect(status(page)).not.toContainText('Renamed')
})

test('rename project dialog accepts the unchanged name as a no-op', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await button(page, 'Rename project…').click()

  await expect(dialogOf(page)).toContainText(
    `New name for the project ${project.name}`,
  )
  await expect(nameField(page)).toHaveValue(project.name)
  await expect(problem(page)).toHaveText('')
  await expect(okButton(page)).toBeEnabled()
  await okButton(page).click()

  await expect(dialogOf(page)).toHaveCount(0)
  await expect(projectMenu(page)).toHaveValue(project.key)
  await expect(saveButton(page)).toHaveText('Saved')
  await expect(status(page)).not.toContainText('Renamed')
  expect(existsSync(project.dir)).toBe(true)
  expect(project.has('components/sun.json')).toBe(true)
})

test('Escape closes both delete dialogs and deletes nothing', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  const before = await componentOptions(page)

  await button(page, 'Delete component…').click()
  await expect(dialogOf(page)).toContainText('Delete the component sun?')
  // It starts on Cancel, never on Delete.
  await expect(cancelButton(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialogOf(page)).toHaveCount(0)
  await expect(componentMenu(page)).toHaveValue('sun')
  await expect(saveButton(page)).toHaveText('Saved')
  expect(await componentOptions(page)).toEqual(before)

  await button(page, 'Delete project…').click()
  await expect(dialogOf(page)).toContainText(
    `Delete the project ${project.name}?`,
  )
  await page.keyboard.press('Escape')
  await expect(dialogOf(page)).toHaveCount(0)
  await expect(projectMenu(page)).toHaveValue(project.key)
  expect(existsSync(project.dir)).toBe(true)
  expect(project.has('components/sun.json')).toBe(true)
})

test('delete component is refused on the last component without opening a dialog', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await button(page, 'Delete component…').click()
  await answerConfirm(page, true)
  await expect(componentMenu(page)).toHaveValue('sun-card')

  await button(page, 'Delete component…').click()
  await expect(status(page)).toContainText(
    "sun-card is the project's only component",
  )
  await expect(dialogOf(page)).toHaveCount(0)
  await expect(componentMenu(page)).toHaveValue('sun-card')
})

test('undo and redo shortcuts do nothing while a delete dialog is open', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await radiusDefault(page).fill('25')
  await leaveField(page)
  await xDefault(page).fill('5')
  await leaveField(page)
  // One step to undo (radius) and one to redo (x).
  await undoButton(page).click()
  await expect(xDefault(page)).toHaveValue('0')
  await expect(radiusDefault(page)).toHaveValue('25')

  await button(page, 'Delete component…').click()
  await expect(dialogOf(page)).toBeVisible()
  for (const keys of ['Control+z', 'Control+y', 'Control+Shift+z'])
    await page.keyboard.press(keys)
  await expect(dialogOf(page)).toBeVisible()
  await expect(radiusDefault(page)).toHaveValue('25')
  await expect(xDefault(page)).toHaveValue('0')
  await answerConfirm(page, false)

  // Closed again, the shortcuts work.
  await page.keyboard.press('Control+y')
  await expect(xDefault(page)).toHaveValue('5')
  await expect(componentMenu(page)).toHaveValue('sun')
})

test('undo shortcut does nothing while a name dialog has focus on its Cancel button', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await radiusDefault(page).fill('25')
  await leaveField(page)

  await button(page, 'New component').click()
  await cancelButton(page).focus()
  await expect(cancelButton(page)).toBeFocused()
  await page.keyboard.press('Control+z')
  await expect(dialogOf(page)).toBeVisible()
  await expect(radiusDefault(page)).toHaveValue('25')
  await cancelButton(page).click()
  await expect(dialogOf(page)).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect(radiusDefault(page)).toHaveValue('20')
})
