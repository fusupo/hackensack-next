// `npm run bundle` (#16): the script is run the way a person runs it, as a
// separate Node process, against the examples (never projects/).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { readBundle } from '../packages/engine/src/index.ts'
import { bundleProject } from './bundle.ts'

const REPO = join(import.meta.dirname, '..')
const SUN_CARD = join(REPO, 'examples/sun-card')
const temp = mkdtempSync(join(tmpdir(), 'hackensack-bundle-'))
afterAll(() => rmSync(temp, { recursive: true, force: true }))

function run(...args: string[]) {
  const result = spawnSync(
    process.execPath,
    [join(REPO, 'scripts/bundle.ts'), ...args],
    {
      cwd: REPO,
      encoding: 'utf8',
    },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

it("the bundle script prints a project component's bundle to stdout", () => {
  const { status, stdout, stderr } = run('examples/sun-card', 'sun-card')
  expect(stderr).toBe('')
  expect(status).toBe(0)
  const read = readBundle(JSON.parse(stdout))
  expect(read.problems).toBeUndefined()
  expect(read.bundle!.root).toBe('sun-card')
  expect(Object.keys(read.bundle!.components)).toEqual(['sun-card', 'sun'])
  // No data without --sample.
  expect(read.bundle).not.toHaveProperty('data')
  expect(stdout).toBe(
    JSON.stringify(bundleProject(SUN_CARD, 'sun-card'), null, 2) + '\n',
  )
})

it("the bundle script adds the component's sample as data with --sample and writes a file with --out", () => {
  const sample = JSON.parse(
    readFileSync(join(SUN_CARD, 'samples/sun-card.data.json'), 'utf8'),
  ) as unknown
  const printed = run('examples/sun-card', 'sun-card', '--sample')
  expect(printed.status).toBe(0)
  expect(JSON.parse(printed.stdout).data).toEqual(sample)

  const file = join(temp, 'sun-card.bundle.json')
  const written = run(
    'examples/sun-card',
    'sun-card',
    '--sample',
    '--out',
    file,
  )
  expect(written.status).toBe(0)
  expect(written.stdout).toBe('')
  expect(readFileSync(file, 'utf8')).toBe(printed.stdout)
})

it('the bundle script exits 1 with a message, empty stdout and no file for an unknown project or component', () => {
  const cases: [string[], RegExp][] = [
    [['examples/no-such-project', 'sun-card'], /no components folder/],
    [['examples/sun-card', 'moon'], /Unknown component "moon"/],
    [['examples/sun-card'], /Usage/],
    [['examples/sun-card', 'sun-card', '--bogus'], /Unknown option --bogus/],
  ]
  cases.forEach(([args, message], i) => {
    const file = join(temp, `failed-${i}.json`)
    const { status, stdout, stderr } = run(...args, '--out', file)
    expect(status, args.join(' ')).toBe(1)
    expect(stderr, args.join(' ')).toMatch(message)
    expect(stdout, args.join(' ')).toBe('')
    expect(existsSync(file), args.join(' ')).toBe(false)
  })
  // And without --out, nothing on stdout either.
  const plain = run('examples/sun-card', 'moon')
  expect(plain.status).toBe(1)
  expect(plain.stdout).toBe('')
})
