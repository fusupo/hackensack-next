// Golden tests: every example project renders to its expected SVG
// (PLAN.md principle 6). Expected files live in examples/<project>/expected/.
// If an engine change alters output on purpose, review the new SVG and update
// the golden files with `npx vitest run -u`.

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile, toSvgString } from './index.ts'
import type { ComponentSpec, Library } from './index.ts'

const EXAMPLES = join(import.meta.dirname, '../../examples')

function loadLibrary(project: string): Library {
  const dir = join(EXAMPLES, project, 'components')
  const library: Record<string, ComponentSpec> = {}
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    library[basename(file, '.json')] = JSON.parse(
      readFileSync(join(dir, file), 'utf8'),
    ) as ComponentSpec
  }
  return library
}

function loadSample(project: string, name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(EXAMPLES, project, 'samples', `${name}.data.json`),
      'utf8',
    ),
  ) as Record<string, unknown>
}

/** Render a component; fail the test on any compile or render error. */
function render(
  project: string,
  component: string,
  data: Record<string, unknown>,
): string {
  const program = compile(component, loadLibrary(project))
  expect(program.errors).toEqual([])
  const { output, errors } = program.render(data)
  expect(errors).toEqual([])
  return toSvgString(output)
}

const count = (svg: string, pattern: RegExp) => svg.match(pattern)?.length ?? 0
const golden = (project: string, file: string) =>
  `../../examples/${project}/expected/${file}`

describe('spinner example', () => {
  const sample = loadSample('spinner', 'spinner')

  it('renders 3 spokes from the sample data', async () => {
    const svg = render('spinner', 'spinner', sample)
    expect(count(svg, /<rect /g)).toBe(3)
    await expect(svg).toMatchFileSnapshot(golden('spinner', 'spinner-3.svg'))
  })

  it('renders 6 spokes when the list has 6 items', async () => {
    const svg = render('spinner', 'spinner', {
      ...sample,
      l: [1, 2, 3, 4, 5, 6],
    })
    expect(count(svg, /<rect /g)).toBe(6)
    await expect(svg).toMatchFileSnapshot(golden('spinner', 'spinner-6.svg'))
  })

  it('places spokes evenly around a circle, like the 2015 engine did', () => {
    const svg = render('spinner', 'spinner', sample)
    // Values from Hackensack commit 020a754 rendering spinner.json.
    expect(svg).toContain('transform="translate(0, 50) rotate(360)"')
    expect(svg).toContain('transform="translate(43.30127, -25) rotate(240)"')
    expect(svg).toContain('transform="translate(-43.30127, -25) rotate(120)"')
  })

  it('resolves an outer variable inside each (the case Hackensack HEAD got wrong)', () => {
    // The rect's height is "cy", a root input, used two frames down inside the each.
    const svg = render('spinner', 'spinner', sample)
    expect(count(svg, /<rect [^>]*height="25"/g)).toBe(3)
  })

  it('renders identically when each spoke is a component instance', () => {
    for (const l of [
      [1, 2, 3],
      [1, 2, 3, 4, 5, 6],
    ]) {
      const flat = render('spinner', 'spinner', { ...sample, l })
      const spoked = render('spinner', 'spinner-spoked', { ...sample, l })
      expect(spoked).toBe(flat)
    }
  })

  it('lets the spoke inherit its color from the spinner', () => {
    const svg = render('spinner', 'spinner-spoked', {
      ...sample,
      color: '#ff8800',
    })
    expect(count(svg, /fill="#ff8800"/g)).toBe(9)
  })
})

describe('rain-bars example', () => {
  const sample = loadSample('rain-bars', 'rain-bars')

  it('renders one bar per rain value and the sun from data', async () => {
    const svg = render('rain-bars', 'rain-bars', sample)
    expect(count(svg, /<rect /g)).toBe(5)
    expect(svg).toContain(
      '<rect x="48" y="40" width="18" height="60" fill="#4a90d9" />',
    )
    expect(svg).toContain('<circle cx="150" cy="24" r="14" fill="#f5b942" />')
    await expect(svg).toMatchFileSnapshot(golden('rain-bars', 'rain-bars.svg'))
  })
})
