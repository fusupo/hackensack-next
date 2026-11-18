// Renaming and deleting projects in the editor (#3's manual check AC-13.e3,
// as browser tests). Each test seeds its own saved copy of the sun-card
// example. A never-saved project lives only in memory and is gone after a
// reload, so these tests work on saved ones.

import { existsSync } from 'node:fs'
import type { Page } from '@playwright/test'
import {
  componentOptions,
  expect,
  openProject,
  projectMenu,
  projectNamed,
  projectOptions,
  saveButton,
  test,
} from './fixtures.ts'
import type { Dialogs } from './fixtures.ts'

/** Make an unsaved change: a new component, `moon`. */
async function addMoon(page: Page, dialogs: Dialogs): Promise<void> {
  dialogs.next({ accept: true, text: 'moon' })
  await page.getByRole('button', { name: 'New component' }).click()
  await expect.poll(() => componentOptions(page)).toContain('moon •')
  await expect(saveButton(page)).toHaveText('Save (1)')
}

test('renames a project with unsaved edits and moves its folder', async ({
  page,
  project,
  dialogs,
}) => {
  const renamed = projectNamed(`${project.name}-renamed`)
  await openProject(page, project)
  await addMoon(page, dialogs)

  dialogs.next({ accept: true, text: renamed.name })
  await page.getByRole('button', { name: 'Rename project…' }).click()
  expect(dialogs.messages[1]).toContain(
    `New name for the project ${project.name}`,
  )

  // The folder moves at once; the unsaved edit comes along, still unsaved.
  await expect(projectMenu(page)).toHaveValue(renamed.key)
  expect(await projectOptions(page)).toContain(`${renamed.name} •`)
  await expect(saveButton(page)).toHaveText('Save (1)')
  await expect.poll(() => existsSync(renamed.dir)).toBe(true)
  expect(existsSync(project.dir)).toBe(false)
  expect(renamed.has('components/sun.json')).toBe(true)
  expect(renamed.has('components/moon.json')).toBe(false)

  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')
  expect(renamed.has('components/moon.json')).toBe(true)
  expect(existsSync(project.dir)).toBe(false)

  await page.reload()
  await projectMenu(page).selectOption(renamed.key)
  await expect(saveButton(page)).toHaveText('Saved')
  const names = await projectOptions(page)
  expect(names).toContain(renamed.name)
  expect(names).not.toContain(project.name)
  expect(await componentOptions(page)).toEqual(['moon', 'sun (3)', 'sun-card'])
})

test('deletes a project after confirming and removes its folder', async ({
  page,
  project,
  dialogs,
}) => {
  await openProject(page, project)
  await addMoon(page, dialogs)
  const deleteButton = page.getByRole('button', { name: 'Delete project…' })

  // Cancelling keeps the project, its unsaved edit and its folder.
  dialogs.next({ accept: false })
  await deleteButton.click()
  const question = dialogs.messages[1]
  expect(question).toContain(`Delete the project ${project.name}?`)
  expect(question).toContain(`Its folder projects/${project.name}`)
  expect(question).toContain('It has unsaved changes (1 file)')
  await expect(projectMenu(page)).toHaveValue(project.key)
  await expect(saveButton(page)).toHaveText('Save (1)')
  expect(existsSync(project.dir)).toBe(true)

  dialogs.next({ accept: true })
  await deleteButton.click()
  // The editor opens another project, and the folder is gone.
  await expect(projectMenu(page)).not.toHaveValue(project.key)
  expect(await projectOptions(page)).not.toContain(`${project.name} •`)
  await expect.poll(() => existsSync(project.dir)).toBe(false)

  await page.reload()
  await expect(projectMenu(page)).toBeVisible()
  const names = await projectOptions(page)
  expect(names).not.toContain(project.name)
  expect(names).toContain('sun-card')
})

test('offers no rename or delete on a read-only example', async ({
  page,
  project,
}) => {
  await openProject(page, project)
  await projectMenu(page).selectOption('examples/sun-card')

  await expect(
    page.getByRole('button', { name: 'Duplicate to edit…' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Rename project…' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Delete project…' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Rename component…' }),
  ).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText(
    'Example: changes are not saved',
  )
})
