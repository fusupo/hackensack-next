// `npm run render` (#61): a component's SVG, and a PNG with --png. Run
// against the examples (never projects/); the PNG tests use the Chromium the
// browser tests use.

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { main, renderProject } from './render.ts'

const REPO = join(import.meta.dirname, '..')
const EXAMPLES = join(REPO, 'examples')
const temp = mkdtempSync(join(tmpdir(), 'hackensack-render-'))
afterAll(() => rmSync(temp, { recursive: true, force: true }))

const golden = (project: string, file: string) =>
  readFileSync(join(EXAMPLES, project, 'expected', file), 'utf8')

function run(...args: string[]) {
  const result = spawnSync(
    process.execPath,
    [join(REPO, 'scripts/render.ts'), ...args],
    { cwd: REPO, encoding: 'utf8' },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** Collects what `main` prints. */
function io() {
  const printed = { out: '', err: '' }
  return {
    printed,
    io: {
      out: (text: string) => (printed.out += text),
      err: (text: string) => (printed.err += text),
    },
  }
}

/** A PNG's width and height, from its IHDR chunk; throws when it isn't a PNG. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file)
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  expect([...bytes.subarray(0, 8)]).toEqual(signature)
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

it('the render script writes SVG equal to the golden of an example, from its sample or from --data', () => {
  const sunCard = join(EXAMPLES, 'sun-card')
  expect(renderProject(sunCard, 'sun-card', { sample: true }).svg).toBe(
    golden('sun-card', 'sun-card.svg'),
  )
  expect(
    renderProject(join(EXAMPLES, 'windmill'), 'windmill', { sample: true }).svg,
  ).toBe(golden('windmill', 'windmill.svg'))
  // A golden drawn from other data: the spinner with six items.
  const six = join(temp, 'spinner-6.data.json')
  writeFileSync(six, JSON.stringify({ l: [1, 2, 3, 4, 5, 6], cy: 25 }))
  expect(
    renderProject(join(EXAMPLES, 'spinner'), 'spinner', { dataFile: six }).svg,
  ).toBe(golden('spinner', 'spinner-6.svg'))
  // From the command line, to a file and to stdout.
  const out = join(temp, 'sun-card.svg')
  const toFile = run('examples/sun-card', 'sun-card', '--sample', '--out', out)
  expect(toFile.stderr).toBe('')
  expect(toFile.status).toBe(0)
  expect(toFile.stdout).toBe('')
  expect(readFileSync(out, 'utf8')).toBe(golden('sun-card', 'sun-card.svg'))
  const printed = run('examples/spinner', 'spinner', '--data', six)
  expect(printed.status).toBe(0)
  expect(printed.stdout.trimEnd()).toBe(
    golden('spinner', 'spinner-6.svg').trimEnd(),
  )
}, 30_000)

it('the render script writes a PNG with --png, sized like the picture', async () => {
  const png = join(temp, 'sun-card.png')
  const { printed, io: streams } = io()
  const code = await main(
    [
      'examples/sun-card',
      'sun-card',
      '--sample',
      '--png',
      png,
      '--out',
      join(temp, 'x.svg'),
    ],
    streams,
  )
  expect(printed.err).toBe('')
  expect(code).toBe(0)
  // sun-card's root svg is 320 by 140.
  expect(pngSize(png)).toEqual({ width: 320, height: 140 })
}, 30_000)

it("the render script wraps a picture whose root isn't an svg, such as a component's own part, so --png still works", async () => {
  const png = join(temp, 'sun.png')
  const svg = join(temp, 'sun.svg')
  const { printed, io: streams } = io()
  const code = await main(
    ['examples/sun-card', 'sun', '--sample', '--png', png, '--out', svg],
    streams,
  )
  expect(printed.err).toBe('')
  expect(code).toBe(0)
  // The written SVG is the engine's output as it is: a part, not an <svg>.
  expect(readFileSync(svg, 'utf8').startsWith('<svg')).toBe(false)
  expect(pngSize(png)).toEqual({ width: 200, height: 200 })
}, 30_000)

it("the render script reports a browser that won't start in one line, exits 1 and writes no PNG", async () => {
  const png = join(temp, 'never.png')
  const { printed, io: streams } = io()
  const code = await main(
    [
      'examples/sun-card',
      'sun-card',
      '--sample',
      '--png',
      png,
      '--out',
      join(temp, 'y.svg'),
    ],
    streams,
    () =>
      Promise.reject(
        new Error("Executable doesn't exist at /nowhere/chrome\nmore detail"),
      ),
  )
  expect(code).toBe(1)
  expect(existsSync(png)).toBe(false)
  expect(printed.err).toBe(
    `render: can't start Chromium; run "npx playwright install chromium" (Executable doesn't exist at /nowhere/chrome)\n`,
  )
})

it('the render script still writes the SVG for a spec with problems, prints them and exits 1', () => {
  const dir = join(temp, 'broken')
  mkdirSync(join(dir, 'components'), { recursive: true })
  writeFileSync(
    join(dir, 'components', 'card.json'),
    JSON.stringify({
      format: 'hackensack/4',
      id: 'c0000001',
      root: 'n0',
      nodes: {
        n0: {
          type: 'svg',
          params: { width: 50, height: 50 },
          children: ['n1', 'n2'],
        },
        n1: {
          type: 'rect',
          params: { width: 50, height: 50, fill: '#abcdef' },
        },
        n2: { type: 'circle', label: 'bad dot', params: { r: 'howMany' } },
      },
    }),
  )
  const out = join(dir, 'card.svg')
  const { status, stdout, stderr } = run(dir, 'card', '--out', out)
  expect(status).toBe(1)
  expect(stdout).toBe('')
  expect(stderr).toBe('card: n2 (bad dot) r: Undefined symbol howMany\n')
  // The rest of the picture still draws.
  expect(readFileSync(out, 'utf8')).toContain('fill="#abcdef"')
  // Nothing to draw at all: no PNG, one line.
  const empty = join(temp, 'empty')
  mkdirSync(join(empty, 'components'), { recursive: true })
  writeFileSync(
    join(empty, 'components', 'none.json'),
    JSON.stringify({
      format: 'hackensack/4',
      id: 'e0000001',
      root: 'gone',
      nodes: {},
    }),
  )
  const png = join(temp, 'none.png')
  const nothing = run(empty, 'none', '--png', png)
  expect(nothing.status).toBe(1)
  expect(existsSync(png)).toBe(false)
  expect(nothing.stderr).toContain('render: nothing to draw.')
}, 30_000)
