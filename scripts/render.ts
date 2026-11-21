// Draws a component of a project folder (#61) to SVG, and to PNG when asked,
// so a person or an AI can look at the picture:
//
//   npm run render -- <projectDir> <component> [--sample | --data <file>]
//                     [--out <file.svg>] [--png <file.png>]
//
// The SVG is the engine's output as it is (equal to an example's golden),
// written to --out or printed. With --png it is also drawn by Playwright's
// Chromium (a dev dependency, installed for the browser tests) and saved as
// a PNG. A component whose root isn't an <svg> (a part such as `sun`) is
// drawn in a 200 x 200 frame centred on its origin, as the editor's preview
// does. When the component has problems, the SVG is still written (the rest
// of the picture draws), the problems are printed on stderr as `npm run
// check` prints them, and the exit code is 1.
//
// Runs with Node 24's type stripping (`node scripts/render.ts`).

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawProject, parseArgs } from './check.ts'
import type { Drawn, Io } from './check.ts'
import type { DataSource } from './project.ts'

/** Draws `component` from `projectDir`; throws on a project that can't be read. */
export function renderProject(
  projectDir: string,
  component: string,
  source: DataSource = {},
): Drawn {
  return drawProject(projectDir, component, source)
}

/**
 * The SVG as a standalone picture: itself when its root is an <svg>, else
 * wrapped in a 200 x 200 frame centred on the origin (as the editor's
 * preview frames a part). Undefined when there is nothing to draw.
 */
export function standalone(svg: string): string | undefined {
  const text = svg.trim()
  if (text === '') return undefined
  if (text.startsWith('<svg')) return text
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" width="200" height="200">${text}</svg>`
}

/** The parts of a Playwright browser `renderPng` uses. */
export interface Browser {
  newPage(): Promise<{
    setContent(html: string): Promise<unknown>
    locator(selector: string): {
      first(): { screenshot(options: { path: string }): Promise<unknown> }
    }
  }>
  close(): Promise<void>
}

/** Starts Playwright's Chromium, loaded only when a PNG is asked for. */
export async function launchChromium(): Promise<Browser> {
  const { chromium } = await import('@playwright/test')
  return (await chromium.launch()) as unknown as Browser
}

/**
 * Draws `svg` in Chromium and saves it to `file` as a PNG, the size of the
 * picture. Throws a one-line message when there is nothing to draw or the
 * browser won't start.
 */
export async function renderPng(
  svg: string,
  file: string,
  launch: () => Promise<Browser> = launchChromium,
): Promise<void> {
  const picture = standalone(svg)
  if (picture === undefined) throw new Error('nothing to draw.')
  let browser: Browser
  try {
    browser = await launch()
  } catch (error) {
    const first = String((error as Error).message ?? error).split('\n')[0]
    throw new Error(
      `can't start Chromium; run "npx playwright install chromium" (${first})`,
    )
  }
  try {
    const page = await browser.newPage()
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#ffffff">${picture}</body></html>`,
    )
    await page.locator('svg').first().screenshot({ path: file })
  } finally {
    await browser.close()
  }
}

const USAGE =
  'Usage: npm run render -- <projectDir> <component> [--sample | --data <file>] [--out <file.svg>] [--png <file.png>]'

/** The command line: resolves to the exit code. */
export async function main(
  argv: string[],
  io: Io,
  launch: () => Promise<Browser> = launchChromium,
): Promise<number> {
  const fail = (message: string) => {
    io.err(`render: ${message}\n`)
    return 1
  }
  let drawn: Drawn
  let out: string | undefined
  let png: string | undefined
  try {
    const parsed = parseArgs(argv, USAGE, ['--out', '--png'])
    out = parsed.extra.out
    png = parsed.extra.png
    drawn = renderProject(parsed.projectDir, parsed.component, parsed.source)
  } catch (error) {
    return fail((error as Error).message)
  }
  const { svg } = drawn
  if (out === undefined) io.out(svg === '' ? '' : `${svg}\n`)
  else {
    try {
      writeFileSync(out, svg)
    } catch (error) {
      return fail(`Can't write ${out}: ${(error as Error).message}`)
    }
  }
  for (const line of drawn.problems) io.err(`${line}\n`)
  if (png !== undefined) {
    try {
      await renderPng(svg, png, launch)
    } catch (error) {
      return fail((error as Error).message)
    }
  }
  return drawn.problems.length > 0 ? 1 : 0
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  }).then((code) => {
    process.exitCode = code
  })
}
