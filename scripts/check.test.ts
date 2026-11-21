// `npm run check` (#61): every problem of a component, one per line. Run
// against the examples (never projects/) and small projects written to a
// temporary folder.

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { checkProject } from './check.ts'

const REPO = join(import.meta.dirname, '..')
const EXAMPLES = join(REPO, 'examples')
const temp = mkdtempSync(join(tmpdir(), 'hackensack-check-'))
afterAll(() => rmSync(temp, { recursive: true, force: true }))

function run(...args: string[]) {
  const result = spawnSync(
    process.execPath,
    [join(REPO, 'scripts/check.ts'), ...args],
    { cwd: REPO, encoding: 'utf8' },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** A project in the temporary folder holding these components. */
function project(name: string, components: Record<string, unknown>): string {
  const dir = join(temp, name)
  mkdirSync(join(dir, 'components'), { recursive: true })
  for (const [file, spec] of Object.entries(components))
    writeFileSync(
      join(dir, 'components', `${file}.json`),
      JSON.stringify(spec, null, 2),
    )
  return dir
}

it('the check script prints nothing and exits 0 for every example component', () => {
  let checked = 0
  for (const example of readdirSync(EXAMPLES)) {
    const dir = join(EXAMPLES, example)
    for (const file of readdirSync(join(dir, 'components'))) {
      const component = basename(file, '.json')
      const sample = existsSync(join(dir, 'samples', `${component}.data.json`))
      expect(
        checkProject(dir, component, { sample }),
        `${example}/${component}`,
      ).toEqual([])
      checked++
    }
  }
  expect(checked).toBeGreaterThan(20)
  // And from the command line.
  const { status, stdout, stderr } = run(
    'examples/sun-card',
    'sun-card',
    '--sample',
  )
  expect(stderr).toBe('')
  expect(stdout).toBe('')
  expect(status).toBe(0)
}, 30_000)

it('the check script prints one line per problem with component, node, label, param and message, and exits 1', () => {
  const dir = project('broken', {
    card: {
      format: 'hackensack/4',
      id: 'c0000001',
      root: 'n0',
      nodes: {
        n0: {
          type: 'svg',
          params: { width: 100, height: 100 },
          children: ['n1', 'n2', 'gone'],
        },
        n1: {
          type: 'circle',
          label: 'bad dot',
          params: { r: '3 +* 4' },
        },
        n2: { type: 'rect', params: { width: '((', height: 5 } },
      },
    },
  })
  const lines = checkProject(dir, 'card')
  expect(lines).toHaveLength(3)
  expect(lines.find((l) => l.includes('n1'))).toMatch(
    /^card: n1 \(bad dot\) r: \S/,
  )
  expect(lines.find((l) => l.includes('n2'))).toMatch(/^card: n2 width: \S/)
  expect(lines).toContain('card: node "gone" doesn\'t exist')
  const { status, stdout, stderr } = run(dir, 'card')
  expect(stderr).toBe('')
  expect(status).toBe(1)
  expect(stdout).toBe(lines.map((l) => `${l}\n`).join(''))
})

it("the check script reports a render-time problem inside an instance with the definition's name, node, label, param, message and the via path", () => {
  const dir = project('inside', {
    top: {
      format: 'hackensack/4',
      id: 't0000001',
      root: 'n0',
      nodes: {
        n0: {
          type: 'svg',
          params: { width: 100, height: 100 },
          children: ['n4'],
        },
        // The top component's own n4 has a label of its own, which the
        // problem inside the part must not take.
        n4: { type: 'component', label: 'the part', ref: 'p0000001' },
      },
    },
    part: {
      format: 'hackensack/4',
      id: 'p0000001',
      root: 'p0',
      nodes: {
        p0: { type: 'g', children: ['p1'] },
        p1: { type: 'circle', label: 'bad dot', params: { r: 'howMany' } },
      },
    },
  })
  const lines = checkProject(dir, 'top')
  expect(lines).toEqual([
    'part: p1 (bad dot) r: Undefined symbol howMany [via n4]',
  ])
  expect(lines[0]).not.toContain('the part')
  const { status, stdout } = run(dir, 'top')
  expect(status).toBe(1)
  expect(stdout).toBe(`${lines[0]}\n`)
}, 30_000)

it('the check script exits 1 with one stderr line for a usage error or an unknown project or component', () => {
  const cases = [
    { args: [], says: 'Usage: npm run check' },
    { args: ['examples/sun-card'], says: 'Usage: npm run check' },
    {
      args: ['examples/sun-card', 'sun-card', '--wat'],
      says: 'Unknown option --wat',
    },
    {
      args: ['examples/sun-card', 'sun-card', '--data'],
      says: '--data needs a file name',
    },
    {
      args: ['examples/sun-card', 'sun-card', '--sample', '--data', 'x.json'],
      says: 'Give --sample or --data, not both',
    },
    {
      args: ['examples/nowhere', 'sun-card'],
      says: 'No project at examples/nowhere',
    },
    { args: ['examples/sun-card', 'moon'], says: 'Unknown component "moon"' },
    {
      args: [
        'examples/sun-card',
        'sun-card',
        '--data',
        join(temp, 'missing.json'),
      ],
      says: "Can't read",
    },
  ]
  for (const { args, says } of cases) {
    const { status, stdout, stderr } = run(...args)
    expect(status, args.join(' ')).toBe(1)
    expect(stdout, args.join(' ')).toBe('')
    expect(stderr.split('\n').filter(Boolean), args.join(' ')).toHaveLength(1)
    expect(stderr, args.join(' ')).toMatch(/^check: /)
    expect(stderr, args.join(' ')).toContain(says)
  }
}, 30_000)
