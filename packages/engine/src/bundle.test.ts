// The bundle format (#16): one component, the definitions it reaches and
// optional default data, as the embeddable player loads it.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { expect, it } from 'vitest'
import {
  BUNDLE_FORMAT,
  bundle,
  compile,
  readBundle,
  SPEC_FORMAT,
  toSvgString,
  withDefaults,
} from './index.ts'
import type { ComponentSpec, Library } from './index.ts'

const EXAMPLES = join(import.meta.dirname, '../../../examples')

function loadLibrary(project: string): Record<string, ComponentSpec> {
  const dir = join(EXAMPLES, project, 'components')
  const library: Record<string, ComponentSpec> = {}
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    library[basename(file, '.json')] = JSON.parse(
      readFileSync(join(dir, file), 'utf8'),
    ) as ComponentSpec
  }
  return library
}

function loadSample(
  project: string,
  name: string,
): Record<string, unknown> | undefined {
  const file = join(EXAMPLES, project, 'samples', `${name}.data.json`)
  if (!existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
}

/** A definition with the given instance refs (and a rect, so it draws). */
function spec(id: string, refs: string[] = []): ComponentSpec {
  const nodes: ComponentSpec['nodes'] = {
    root: {
      type: 'svg',
      params: { width: 10, height: 10 },
      children: refs.map((_, i) => `i${i}`),
    },
  }
  refs.forEach((ref, i) => {
    nodes[`i${i}`] = { type: 'component', ref }
  })
  return { format: SPEC_FORMAT, id, root: 'root', nodes }
}

it('bundle holds the root and only the definitions it reaches, following refs by id', () => {
  const library = loadLibrary('weather-card')
  // A definition nothing uses stays out.
  library.unused = spec('0000aaaa')
  const result = bundle('weather-card', library)
  expect(result.format).toBe(BUNDLE_FORMAT)
  expect(result.root).toBe('weather-card')
  expect(Object.keys(result.components).sort()).toEqual([
    'cloud',
    'raindrop',
    'sun',
    'weather-card',
  ])
  // A leaf component bundles alone.
  expect(Object.keys(bundle('sun', library).components)).toEqual(['sun'])
  // Refs are ids, not names: rename the file and the bundle follows the id.
  const renamed: Record<string, ComponentSpec> = { ...library }
  renamed['the-sun'] = renamed.sun
  delete renamed.sun
  expect(Object.keys(bundle('weather-card', renamed).components)).toContain(
    'the-sun',
  )
})

it('bundle keys components by name, drops the editor section and gives the same JSON every time', () => {
  const library = loadLibrary('weather-card')
  library['weather-card'] = {
    ...library['weather-card'],
    editor: { positions: { root: { x: 1, y: 2 } } },
  }
  const result = bundle('weather-card', library)
  // The root first, then in the order reached.
  expect(Object.keys(result.components)[0]).toBe('weather-card')
  expect(Object.keys(result.components)).toEqual([
    'weather-card',
    'sun',
    'cloud',
    'raindrop',
  ])
  for (const [name, def] of Object.entries(result.components)) {
    expect(def, name).not.toHaveProperty('editor')
    expect(def.id, name).toBe(library[name].id)
  }
  // The library itself is untouched.
  expect(library['weather-card'].editor).toBeDefined()
  expect(JSON.stringify(bundle('weather-card', library))).toBe(
    JSON.stringify(result),
  )
})

it('bundle copes with a ref cycle, an unknown ref and one definition used twice', () => {
  const library: Library = {
    a: spec('aaaaaaaa', ['bbbbbbbb', 'bbbbbbbb', 'ffffffff']),
    b: spec('bbbbbbbb', ['aaaaaaaa']),
    c: spec('cccccccc'),
  }
  const result = bundle('a', library)
  expect(Object.keys(result.components)).toEqual(['a', 'b'])
  // The unknown ref is kept as it is.
  expect(result.components.a.nodes.i2.ref).toBe('ffffffff')
})

it('bundle refuses a root that is not in the library', () => {
  const library = loadLibrary('sun-card')
  expect(() => bundle('moon', library)).toThrow('Unknown component "moon"')
  // Not fooled by Object's own properties.
  expect(() => bundle('toString', library)).toThrow(/Unknown component/)
})

it('bundle carries the given data and leaves data out when there is none', () => {
  const library = loadLibrary('sun-card')
  const sample = loadSample('sun-card', 'sun-card')!
  expect(bundle('sun-card', library, sample).data).toEqual(sample)
  const bare = bundle('sun-card', library)
  expect(bare).not.toHaveProperty('data')
  expect(JSON.parse(JSON.stringify(bare))).not.toHaveProperty('data')
})

it('bundling any component of any example renders the same picture as the whole library', () => {
  let checked = 0
  for (const project of readdirSync(EXAMPLES)) {
    const library = loadLibrary(project)
    for (const name of Object.keys(library)) {
      const sample = loadSample(project, name) ?? {}
      const whole = compile(name, library)
      const expected = whole.render(sample)
      // Through JSON, as a page gets it.
      const b = JSON.parse(JSON.stringify(bundle(name, library, sample)))
      const read = readBundle(b)
      expect(read.problems, `${project}/${name}`).toBeUndefined()
      const program = compile(read.bundle!.root, read.bundle!.components)
      expect(program.errors, `${project}/${name}`).toEqual(whole.errors)
      const actual = program.render(withDefaults(read.bundle!))
      expect(actual.errors, `${project}/${name}`).toEqual(expected.errors)
      expect(toSvgString(actual.output), `${project}/${name}`).toBe(
        toSvgString(expected.output),
      )
      checked++
    }
  }
  expect(checked).toBeGreaterThanOrEqual(18)
})

it('readBundle reports a malformed bundle instead of throwing and returns a good one', () => {
  const good = bundle('sun-card', loadLibrary('sun-card'), { color: 'red' })
  expect(readBundle(good)).toEqual({ bundle: good })
  expect(readBundle(JSON.parse(JSON.stringify(good))).bundle).toEqual(good)

  const bad: [unknown, RegExp][] = [
    [null, /JSON object/],
    [[], /JSON object/],
    ['text', /JSON object/],
    [{ ...good, format: 'hackensack/3' }, /format/],
    [{ ...good, format: undefined }, /format is missing/],
    [{ ...good, root: 7 }, /no root/],
    [{ ...good, root: 'moon' }, /"moon" is not in the bundle/],
    [{ ...good, components: [] }, /no components/],
    [{ ...good, components: { 'sun-card': 3 } }, /"sun-card" is not an object/],
    [{ ...good, data: [1] }, /data must be an object/],
  ]
  for (const [input, message] of bad) {
    const result = readBundle(input)
    expect(result.bundle, JSON.stringify(input)).toBeUndefined()
    expect(
      result.problems!.map((p) => p.message).join(' '),
      JSON.stringify(input),
    ).toMatch(message)
  }
})

it("given data replaces a bundle's default data one top-level input at a time", () => {
  const defaults = { a: 1, list: [1, 2, 3], style: { fill: 'red', r: 4 }, n: 5 }
  expect(withDefaults({ data: defaults })).toEqual(defaults)
  expect(withDefaults({}, { a: 2 })).toEqual({ a: 2 })
  const merged = withDefaults(
    { data: defaults },
    { a: 2, list: [9], style: { fill: 'blue' }, n: undefined, extra: true },
  )
  expect(merged).toEqual({
    a: 2,
    // Whole values: a list or an object is replaced, never merged into.
    list: [9],
    style: { fill: 'blue' },
    // undefined keeps the default.
    n: 5,
    extra: true,
  })
  // null is a value.
  expect(withDefaults({ data: defaults }, { a: null }).a).toBeNull()
  // The bundle's data is not changed.
  expect(defaults.a).toBe(1)
})
