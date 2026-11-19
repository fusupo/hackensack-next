// Golden tests: every example project renders to its expected SVG
// (PLAN.md principle 6). Expected files live in examples/<project>/expected/.
// If an engine change alters output on purpose, review the new SVG and update
// the golden files with `npx vitest run -u`.

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile, indexById, SPEC_FORMAT, toSvgString } from './index.ts'
import type { ComponentSpec, Library } from './index.ts'

const REPO = join(import.meta.dirname, '../..')
const EXAMPLES = join(REPO, 'examples')

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

// The examples are the only libraries in the repo: projects/ is where the
// editor saves your work, and it's git-ignored (#5).
it('every example library is v3 with unique ids and resolvable refs', () => {
  for (const project of readdirSync(EXAMPLES)) {
    const folder = join(EXAMPLES, project)
    const library = loadLibrary(project)
    expect(Object.keys(library).length, folder).toBeGreaterThan(0)
    const byId = indexById(library)
    for (const [name, spec] of Object.entries(library)) {
      const where = `${folder}: ${name}`
      expect(spec.format, where).toBe(SPEC_FORMAT)
      expect(spec.id, where).toMatch(/^[0-9a-f]{8}$/)
      expect(byId.get(spec.id), where).toEqual([name])
      for (const [id, node] of Object.entries(spec.nodes)) {
        if (node.type !== 'component') continue
        expect(byId.get(node.ref ?? ''), `${where} ${id}`).toHaveLength(1)
      }
    }
    // No reference or format problems (a project may have other, unrelated ones).
    for (const name of Object.keys(library)) {
      const problems = compile(name, library)
        .errors.map((e) => e.message)
        .filter((m) => /\bid\b|"ref"|no component|spec format/.test(m))
      expect(problems, `${folder}: ${name}`).toEqual([])
    }
  }
})

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

describe('sun-card example', () => {
  const sample = loadSample('sun-card', 'sun-card')
  const bodies = (svg: string) => svg.match(/<circle [^>]*\/>/g) ?? []

  it('renders three suns at different sizes', async () => {
    const svg = render('sun-card', 'sun-card', sample)
    expect(bodies(svg)).toHaveLength(3)
    for (const r of [10, 20, 40])
      expect(count(svg, new RegExp(`<circle [^>]*r="${r}"`, 'g'))).toBe(1)
    await expect(svg).toMatchFileSnapshot(golden('sun-card', 'sun-card.svg'))
  })

  it('changes all three suns when the sun definition is edited', () => {
    // M4's acceptance case: one edit inside the definition, every instance follows.
    const library = loadLibrary('sun-card')
    const sun = library['sun']!
    const edited: Library = {
      ...library,
      sun: {
        ...sun,
        nodes: {
          ...sun.nodes,
          s5: { ...sun.nodes['s5']!, params: { r: 'radius', fill: '#ff0000' } },
        },
      },
    }
    const program = compile('sun-card', edited)
    expect(program.errors).toEqual([])
    const { output, errors } = program.render(sample)
    expect(errors).toEqual([])
    const after = bodies(toSvgString(output))
    expect(after).toHaveLength(3)
    for (const body of after) expect(body).toContain('fill="#ff0000"')
    const before = bodies(render('sun-card', 'sun-card', sample))
    for (const body of before) expect(body).not.toContain('#ff0000')
  })
})

describe('raindrops example', () => {
  const sample = loadSample('raindrops', 'raindrops')
  /** The grid's cell groups, inside the outer translate(22, 22). */
  const cells = (svg: string) =>
    [...svg.matchAll(/<g transform="translate\(([^)]*)\)">/g)]
      .map((m) => m[1])
      .filter((t) => t !== '22, 22')

  it('renders one raindrop per 5 mm of rain, whole drops only', async () => {
    // 32 mm: six whole drops, a row of five and one more; the .4 is dropped.
    const svg = render('raindrops', 'raindrops', sample)
    expect(sample).toEqual({ rain: 32 })
    expect(cells(svg)).toEqual([
      '0, 0',
      '24, 0',
      '48, 0',
      '72, 0',
      '96, 0',
      '0, 28',
    ])
    expect(count(svg, /<ellipse /g)).toBe(6)
    await expect(svg).toMatchFileSnapshot(
      golden('raindrops', 'raindrops-32.svg'),
    )
  })

  it('draws no raindrops for no rain and one full row for 25 mm', () => {
    const none = render('raindrops', 'raindrops', { rain: 0 })
    expect(cells(none)).toEqual([])
    expect(count(none, /<ellipse /g)).toBe(0)
    const row = render('raindrops', 'raindrops', { rain: 25 })
    expect(cells(row)).toEqual(['0, 0', '24, 0', '48, 0', '72, 0', '96, 0'])
  })
})

describe('weather-sky example', () => {
  const sample = loadSample('weather-sky', 'weather-sky')
  const sunY = (svg: string) => /<circle [^>]*cy="([^"]*)"/.exec(svg)?.[1]
  const sky = (svg: string) => /<rect [^>]*fill="([^"]*)"/.exec(svg)?.[1]

  it('renders the sun height and sky colour from the sample', async () => {
    // 15 degrees is halfway along -10..40, so the sun sits halfway between
    // the horizon (100) and the top (20); 60% cloud greys the sky.
    const svg = render('weather-sky', 'weather-sky', sample)
    expect(sample).toEqual({ temperature: 15, cloud: 60 })
    expect(sunY(svg)).toBe('60')
    expect(sky(svg)).toBe('#9fb1c2')
    await expect(svg).toMatchFileSnapshot(
      golden('weather-sky', 'weather-sky.svg'),
    )
  })

  it('keeps the sun between the top and the horizon at extreme temperatures', () => {
    const hot = render('weather-sky', 'weather-sky', {
      temperature: 60,
      cloud: 0,
    })
    expect(sunY(hot)).toBe('20')
    expect(sky(hot)).toBe('#bfe3ff')
    const cold = render('weather-sky', 'weather-sky', {
      temperature: -30,
      cloud: 100,
    })
    expect(sunY(cold)).toBe('100')
    expect(sky(cold)).toBe('#8a8f99')
  })
})

describe('pictograms example', () => {
  const sample = loadSample('pictograms', 'pictograms')
  const attrOf = (svg: string, tag: string, name: string) =>
    new RegExp(`<${tag} [^>]*${name}="([^"]*)"`).exec(svg)?.[1]
  const paths = (svg: string) =>
    [...svg.matchAll(/<path d="([^"]*)"/g)].map((m) => m[1])

  it('renders the cloud, the drops and the trend line from the sample', async () => {
    const svg = render('pictograms', 'pictograms', sample)
    expect(sample).toEqual({ temps: [12, 15, 9, 18, 14], rain: 12, wind: 30 })
    // The cloud is a pasted icon path (no holes), written exactly as stored;
    // the drop's path is filled in from its size, here the rain (12).
    const [cloud, drop] = paths(svg)
    expect(cloud).toBe(
      'M14 36a10 10 0 0 1-2-19.8A14 14 0 0 1 39 13a11 11 0 0 1 13 10.5A6.5 6.5 0 0 1 51 36z',
    )
    expect(drop).toBe(
      'M 0 -12 C 7.2 -2.4, 7.2 8.4, 0 8.4 C -7.2 8.4, -7.2 -2.4, 0 -12 Z',
    )
    // One point per temperature, 20 apart, higher for warmer.
    expect(attrOf(svg, 'polyline', 'points')).toBe(
      '0,76 20,70 40,82 60,64 80,72',
    )
    expect(attrOf(svg, 'polygon', 'points')).toBe('0,-5 30,0 0,5')
    await expect(svg).toMatchFileSnapshot(
      golden('pictograms', 'pictograms.svg'),
    )
  })

  it('redraws the drop and the trend line for other data', () => {
    const svg = render('pictograms', 'pictograms', {
      temps: [10, 20, 30, 40, 50, 60],
      rain: 30,
      wind: 0,
    })
    expect(attrOf(svg, 'polyline', 'points')).toBe(
      '0,80 20,60 40,40 60,20 80,0 100,-20',
    )
    // The drop's size is clamped to 18.
    expect(paths(svg)[1]).toBe(
      'M 0 -18 C 10.8 -3.6, 10.8 12.6, 0 12.6 C -10.8 12.6, -10.8 -3.6, 0 -18 Z',
    )
    expect(attrOf(svg, 'polygon', 'points')).toBe('0,-5 0,0 0,5')
    // The cloud's path has no holes, so it never changes.
    expect(paths(svg)[0]).toBe(
      paths(render('pictograms', 'pictograms', sample))[0],
    )
  })
})
