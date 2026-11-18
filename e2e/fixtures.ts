// Shared fixtures for the browser tests.
//
// `project` seeds a project of its own for each test: a copy of the sun-card
// example in the dev server's temporary projects folder, under a unique name.
// Tests never share state, so they don't depend on their order.

import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, expect } from '@playwright/test'
import type { Dialog, Page } from '@playwright/test'

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

/** Answers to the editor's `prompt`/`confirm` dialogs, and what they asked. */
export interface Dialogs {
  /** Answer the next dialog: accept (with text, for a prompt) or dismiss. */
  next: (answer: { accept: true; text?: string } | { accept: false }) => void
  /** Every dialog message so far, oldest first. */
  messages: string[]
}

export const test = base.extend<{
  project: SeededProject
  seed: (name?: string) => SeededProject
  dialogs: Dialogs
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
  dialogs: async ({ page }, provide) => {
    const messages: string[] = []
    const answers: Parameters<Dialogs['next']>[0][] = []
    const handle = async (dialog: Dialog) => {
      messages.push(dialog.message())
      const answer = answers.shift()
      if (answer?.accept) await dialog.accept(answer.text)
      else await dialog.dismiss()
    }
    page.on('dialog', handle)
    await provide({ next: (answer) => answers.push(answer), messages })
    page.off('dialog', handle)
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
