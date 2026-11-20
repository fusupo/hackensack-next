// Helpers for the player's browser tests (#16).
//
// The pages are served by page.route on the dev server's own origin, under
// /player-test/, so nothing is added to the config and no demo page is
// committed. The player files are the real build output: builtPlayer()
// builds packages/player once per run into the run's temporary folder.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { SPEC_FORMAT, bundle } from '../packages/engine/src/index.ts'
import type { Bundle, ComponentSpec } from '../packages/engine/src/index.ts'
import { bundleProject } from '../scripts/bundle.ts'

const REPO = join(import.meta.dirname, '..')

export const ES_FILE = 'hackensack-player.js'
export const IIFE_FILE = 'hackensack-player.iife.js'

let building: Promise<string> | undefined

/** Builds the player once per run; resolves to the folder holding its files. */
export function builtPlayer(): Promise<string> {
  const base = process.env.HACKENSACK_E2E_DIR
  if (!base)
    throw new Error(
      'HACKENSACK_E2E_DIR is not set; run through playwright.config.ts',
    )
  const outDir = join(base, 'player-dist')
  building ??= existsSync(join(outDir, IIFE_FILE))
    ? Promise.resolve(outDir)
    : build({
        configFile: join(REPO, 'packages/player/vite.config.ts'),
        logLevel: 'warn',
        build: { outDir, emptyOutDir: true },
      }).then(() => outDir)
  return building
}

/** A file the test page can fetch: a body, or just a status. */
export type Served = string | { status: number; body?: string }

/**
 * Serves `html` as /player-test/page.html with the built player files and
 * `files` next to it (anything else is a 404), and opens the page.
 */
export async function servePage(
  page: Page,
  html: string,
  files: Record<string, Served> = {},
): Promise<void> {
  const dist = await builtPlayer()
  await page.route('**/player-test/**', async (route) => {
    const name = new URL(route.request().url()).pathname.replace(
      /^\/player-test\//,
      '',
    )
    if (name === 'page.html') {
      return route.fulfill({ body: html, contentType: 'text/html' })
    }
    if (name === ES_FILE || name === IIFE_FILE) {
      return route.fulfill({
        body: readFileSync(join(dist, name), 'utf8'),
        contentType: 'text/javascript',
      })
    }
    const file = files[name]
    if (file === undefined)
      return route.fulfill({ status: 404, body: 'Not found' })
    if (typeof file === 'string') {
      return route.fulfill({ body: file, contentType: 'application/json' })
    }
    return route.fulfill({ status: file.status, body: file.body ?? '' })
  })
  await page.goto('/player-test/page.html')
}

/** A page body with the IIFE player loaded after it. */
export function iifePage(body: string, script = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
${body}
<script src="${IIFE_FILE}"></script>
${script ? `<script>${script}</script>` : ''}
</body></html>`
}

/** A bundle made from an example project, as `npm run bundle` makes it. */
export function exampleBundle(
  project: string,
  component: string,
  options: { sample?: boolean } = {},
): Bundle {
  return bundleProject(join(REPO, 'examples', project), component, options)
}

/**
 * A small bundle whose inputs show directly: a rect `a` wide filled with
 * `color`, and one circle per item of `xs`. Default data: a 10, red, three
 * items. `width` replaces the rect's width param (to make it fail).
 */
export function chipsBundle(width = '=a'): Bundle {
  const spec: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'c41b0001',
    inputs: {
      a: { type: 'number' },
      color: { type: 'string' },
      xs: { type: 'list' },
    },
    root: 'root',
    nodes: {
      root: {
        type: 'svg',
        params: { width: 200, height: 100 },
        children: ['bar', 'dots'],
      },
      bar: { type: 'rect', params: { width, height: 20, fill: '=color' } },
      dots: { type: 'each', params: { list: 'xs' }, children: ['dot'] },
      dot: {
        type: 'circle',
        params: { cx: '=10 + i * 20', cy: 60, r: 5, fill: '#333333' },
      },
    },
  }
  return bundle(
    'chips',
    { chips: spec },
    { a: 10, color: 'red', xs: [1, 2, 3] },
  )
}

/** JSON for inlining in a <script> (no `</script>` can end it early). */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
