// Shared fixtures for the browser tests.
//
// `project` seeds a project of its own for each test: a copy of the sun-card
// example in the dev server's temporary projects folder, under a unique name.
// Tests never share state, so they don't depend on their order.

import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export { expect }

const EXAMPLE = join(import.meta.dirname, '..', 'examples', 'sun-card')

/** The dev server's projects folder (see playwright.config.ts). */
export function projectsDir(): string {
  const dir = process.env.HACKENSACK_E2E_DIR
  if (!dir)
    throw new Error(
      'HACKENSACK_E2E_DIR is not set; run through playwright.config.ts',
    )
  return join(dir, 'projects')
}

export interface SeededProject {
  /** The project's name, which is also its folder's. */
  name: string
  /** Its folder on disk. */
  dir: string
  /** The option value of the Project menu: `projects/<name>`. */
  key: string
  /** Whether a file exists, relative to the project folder. */
  has: (path: string) => boolean
  /** A file's text, relative to the project folder. */
  read: (path: string) => string
  /** A file's JSON, relative to the project folder. */
  json: (path: string) => Record<string, unknown>
}

/** A project folder in the dev server's projects folder, whether or not it exists. */
export function projectNamed(name: string): SeededProject {
  const dir = join(projectsDir(), name)
  return {
    name,
    dir,
    key: `projects/${name}`,
    has: (path) => existsSync(join(dir, path)),
    read: (path) => readFileSync(join(dir, path), 'utf8'),
    json: (path) =>
      JSON.parse(readFileSync(join(dir, path), 'utf8')) as Record<
        string,
        unknown
      >,
  }
}

let counter = 0

export const test = base.extend<{
  project: SeededProject
  seed: (name?: string) => SeededProject
}>({
  // Copies only components/ and samples/: the server refuses to delete a
  // project folder holding anything else (examples also have expected/).
  seed: async ({}, provide) => {
    const made: string[] = []
    await provide((name = `e2e-${process.pid}-${++counter}`) => {
      const p = projectNamed(name)
      for (const kind of ['components', 'samples'])
        cpSync(join(EXAMPLE, kind), join(p.dir, kind), { recursive: true })
      made.push(p.dir)
      return p
    })
    for (const dir of made) rmSync(dir, { recursive: true, force: true })
  },
  project: async ({ seed }, provide) => {
    await provide(seed())
  },
})

// The menus are `<label>Project <select>…</select></label>`. getByLabel
// matches the label's text, which also holds every option's text, so find
// them by role and accessible name instead.

/** The Project menu. */
export function projectMenu(page: Page) {
  return page.getByRole('combobox', { name: 'Project', exact: true })
}

/** The Component menu. */
export function componentMenu(page: Page) {
  return page.getByRole('combobox', { name: 'Component', exact: true })
}

/** Open the editor on a project. */
export async function openProject(
  page: Page,
  project: SeededProject,
): Promise<void> {
  await page.goto('/')
  await projectMenu(page).selectOption(project.key)
}

/** Pick a component in the Component menu by name. */
export async function pickComponent(page: Page, name: string): Promise<void> {
  await componentMenu(page).selectOption(name)
}

/** The Component menu's option labels, e.g. `sun (3)` or `star •`. */
export async function componentOptions(page: Page): Promise<string[]> {
  return (await componentMenu(page).locator('option').allTextContents()).map(
    (t) => t.trim(),
  )
}

/** The Project menu's option labels. */
export async function projectOptions(page: Page): Promise<string[]> {
  return (await projectMenu(page).locator('option').allTextContents()).map(
    (t) => t.trim(),
  )
}

/** The save button: reads `Save (N)` with changes pending, else `Saved`. */
export function saveButton(page: Page) {
  return page.getByRole('button', { name: /^(Save \(\d+\)|Saved)$/ })
}

// The editor asks for names and confirms deletes in its own modal dialog
// (AppDialog), a native <dialog> with role "dialog". While one is open the
// rest of the page is inert.

/** The open dialog. */
export function dialogOf(page: Page) {
  return page.getByRole('dialog')
}

/** Type a name into the open name dialog and press OK; it closes. */
export async function answerName(page: Page, text: string): Promise<void> {
  const dialog = dialogOf(page)
  await dialog.getByRole('textbox').fill(text)
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

/** Answer the open delete dialog: Delete, or Cancel; it closes. */
export async function answerConfirm(
  page: Page,
  accept: boolean,
): Promise<void> {
  const dialog = dialogOf(page)
  await dialog
    .getByRole('button', { name: accept ? 'Delete' : 'Cancel', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
}
