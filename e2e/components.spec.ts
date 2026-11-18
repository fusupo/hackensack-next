// Renaming, duplicating and deleting components in the editor (#3's manual
// checks AC-15.e1 and AC-7.e6, as browser tests). Each test seeds its own
// copy of the sun-card example: `sun` is drawn three times by `sun-card`.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  componentMenu,
  componentOptions,
  expect,
  openProject,
  pickComponent,
  projectMenu,
  saveButton,
  test,
} from './fixtures.ts'

const SEED_SUN_CARD = readFileSync(
  join(
    import.meta.dirname,
    '..',
    'examples',
    'sun-card',
    'components',
    'sun-card.json',
  ),
  'utf8',
)

test('renames a component, keeps its instances working and saves the move', async ({
  page,
  project,
  dialogs,
}) => {
  await openProject(page, project)
  await pickComponent(page, 'sun')

  dialogs.next({ accept: true, text: 'star' })
  await page.getByRole('button', { name: 'Rename component…' }).click()
  expect(dialogs.messages[0]).toContain('New name for sun')

  // Renamed in memory: the menu marks it unsaved, and the instances follow
  // (they refer to the definition's id, not its name).
  await expect.poll(() => componentOptions(page)).toContain('star (3) •')
  expect(await componentOptions(page)).not.toContain('sun (3)')
  await pickComponent(page, 'sun-card')
  await expect(page.locator('.bloq-type', { hasText: /^star$/ })).toHaveCount(3)
  await expect(page.locator('.bloq-type.missing')).toHaveCount(0)

  // Two files to write, two to delete; nothing on disk changes before Save.
  await expect(saveButton(page)).toHaveText('Save (4)')
  expect(project.has('components/sun.json')).toBe(true)
  expect(project.has('components/star.json')).toBe(false)

  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')
  expect(project.has('components/star.json')).toBe(true)
  expect(project.has('samples/star.data.json')).toBe(true)
  expect(project.has('components/sun.json')).toBe(false)
  expect(project.has('samples/sun.data.json')).toBe(false)
  // The component that uses it isn't rewritten: its refs are ids.
  expect(project.read('components/sun-card.json')).toBe(SEED_SUN_CARD)

  await page.reload()
  await projectMenu(page).selectOption(project.key)
  await expect(saveButton(page)).toHaveText('Saved')
  expect(await componentOptions(page)).toEqual(['star (3)', 'sun-card'])
})

test('duplicates a component under a new name with a new id', async ({
  page,
  project,
  dialogs,
}) => {
  await openProject(page, project)
  await pickComponent(page, 'sun')

  dialogs.next({ accept: true, text: 'sun2' })
  await page.getByRole('button', { name: 'Duplicate component…' }).click()
  expect(dialogs.messages[0]).toContain('Name for the copy of sun')

  // The copy opens, unsaved, with the same graph.
  await expect(componentMenu(page)).toHaveValue('sun2')
  await expect.poll(() => componentOptions(page)).toContain('sun2 •')
  await expect(saveButton(page)).toHaveText('Save (2)')

  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')
  const sun = project.json('components/sun.json')
  const copy = project.json('components/sun2.json')
  expect(project.has('samples/sun2.data.json')).toBe(true)
  expect(copy.id).not.toBe(sun.id)
  expect({ ...copy, id: sun.id }).toEqual(sun)
  // The original is untouched.
  expect(project.read('components/sun.json')).toBe(
    readFileSync(
      join(
        import.meta.dirname,
        '..',
        'examples',
        'sun-card',
        'components',
        'sun.json',
      ),
      'utf8',
    ),
  )

  await page.reload()
  await projectMenu(page).selectOption(project.key)
  await expect(saveButton(page)).toHaveText('Saved')
  expect(await componentOptions(page)).toContain('sun2')
})

test('deletes a component after confirming, and its instances show as missing', async ({
  page,
  project,
  dialogs,
}) => {
  await openProject(page, project)
  await pickComponent(page, 'sun')
  const deleteButton = page.getByRole('button', { name: 'Delete component…' })

  // Cancelling changes nothing.
  dialogs.next({ accept: false })
  await deleteButton.click()
  expect(dialogs.messages[0]).toContain('Delete the component sun?')
  expect(dialogs.messages[0]).toContain('It has 3 instances in this project')
  await expect(componentMenu(page)).toHaveValue('sun')
  await expect(saveButton(page)).toHaveText('Saved')

  dialogs.next({ accept: true })
  await deleteButton.click()
  // The editor moves to the remaining component, with a one-crumb trail.
  const trail = page.getByRole('navigation', { name: 'Component trail' })
  await expect(trail.locator('.breadcrumb-current')).toHaveText('sun-card')
  await expect(trail.locator('.breadcrumb')).toHaveCount(0)
  expect(await componentOptions(page)).toEqual(['sun-card'])
  await expect(saveButton(page)).toHaveText('Save (2)')
  // Deleted from disk only on Save.
  expect(project.has('components/sun.json')).toBe(true)

  await saveButton(page).click()
  await expect(saveButton(page)).toHaveText('Saved')
  expect(project.has('components/sun.json')).toBe(false)
  expect(project.has('samples/sun.data.json')).toBe(false)
  // Its instances stay, marked as missing their definition.
  await expect(page.locator('.bloq-type.missing')).toHaveCount(3)
  await expect(page.locator('.bloq-type.missing').first()).toHaveText(
    'missing component',
  )

  await page.reload()
  await projectMenu(page).selectOption(project.key)
  expect(await componentOptions(page)).toEqual(['sun-card'])
  await expect(page.locator('.bloq-type.missing')).toHaveCount(3)
})
