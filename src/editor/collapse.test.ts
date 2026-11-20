import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { expect, it } from 'vitest'
import { compile, SPEC_FORMAT, toSvgString } from '@hackensack/engine'
import type { ComponentSpec, Library, NodeSpec } from '@hackensack/engine'
import {
  collapseInputs,
  collapseName,
  collapseProblem,
  collapseSample,
  planCollapse,
} from './collapse.ts'
import { collapseToComponent } from './projectHistory.ts'
import type { Project } from './projects.ts'
import { scopeAt } from './scope.ts'
import { settleTrail } from './trail.ts'
import type { Trail } from './trail.ts'

const NEW_ID = 'c0ffee00'

function spec(
  id: string,
  nodes: Record<string, NodeSpec>,
  inputs: ComponentSpec['inputs'] = {},
  editor?: ComponentSpec['editor'],
): ComponentSpec {
  return {
    format: SPEC_FORMAT,
    id,
    inputs,
    root: 'n0',
    nodes,
    ...(editor && { editor }),
  }
}

/**
 * A badge whose `color` and `r` inputs are inherited when not bound, and a
 * card that uses it beside an `each`, a `grid`, an `expose`, a `string`
 * input and the expression helpers.
 */
function rich(): Record<string, ComponentSpec> {
  const badge = spec(
    'badge001',
    {
      n0: { type: 'g', children: ['n1', 'n2'] },
      n1: { type: 'circle', params: { r: 'r', fill: '=color' } },
      n2: { type: 'text', params: { text: '=label' } },
    },
    {
      color: { type: 'string', inherit: true },
      r: { type: 'number', inherit: true, default: 2 },
      label: { type: 'string', default: '' },
    },
  )
  const card = spec(
    'card0001',
    {
      n0: {
        type: 'svg',
        params: { width: 200, height: 200 },
        children: ['n1', 'n5', 'n9', 'n12'],
      },
      n1: {
        type: 'each',
        params: { list: 'items', as: 'd', index: 'i' },
        children: ['n2'],
      },
      n2: {
        type: 'g',
        params: { transform: 'translate(i * 30, size)' },
        children: ['n3', 'n4'],
      },
      n3: {
        type: 'circle',
        params: { r: 'd', cx: '=d + gap', fill: '=color' },
      },
      // Rebinds d for its children; its own list reads the outer d.
      n4: { type: 'each', params: { list: '[d, d * 2]' }, children: ['n13'] },
      n13: { type: 'rect', params: { width: 'd', height: 'i + 1' } },
      n5: {
        type: 'grid',
        params: {
          count: 3,
          columns: 2,
          spacing: 'gap * 5',
          col: 'c',
          row: 'r',
          index: 'k',
        },
        children: ['n6'],
      },
      n6: { type: 'g', children: ['n7'] },
      n7: {
        type: 'path',
        params: { d: 'M 0 0 L {c * 10} {r * 10 + k} Z', stroke: '=color' },
      },
      n9: {
        type: 'g',
        params: { opacity: 0.8, transform: 'translate(5, 5)' },
        expose: { op: 'opacity' },
        children: ['n10', 'n11'],
      },
      n10: {
        type: 'polygon',
        params: { points: '0,0 {op * 10},0 5,{size}', fill: 'blue' },
      },
      n11: { type: 'component', ref: 'badge001', params: { label: 'hi' } },
      n12: {
        type: 'text',
        params: {
          text: '=string(remap(size, 0, 20, 0, 1))',
          x: 'pi',
          y: '=clamp(size, 0, 5)',
          fill: '=mix("#000000", color, 0.5)',
        },
      },
    },
    {
      items: { type: 'list', default: [3, 5] },
      color: { type: 'string', default: '#cc3333' },
      size: { type: 'number', default: 10 },
      gap: { type: 'number' },
    },
  )
  return { badge, card }
}

const richSamples = {
  card: { items: [3, 5], gap: 4 },
  badge: { color: '#0000ff', label: 'x' },
}

/** Render `name` and return its SVG and every problem the engine reports. */
function draw(library: Library, name: string, data: Record<string, unknown>) {
  const program = compile(name, library)
  const { output, errors } = program.render(data)
  return { svg: toSvgString(output), compile: program.errors, render: errors }
}

/** The library after collapsing `nodeId` of `component`, and the plan. */
function collapsed(
  library: Library,
  component: string,
  nodeId: string,
  sample?: Record<string, unknown>,
  id = NEW_ID,
) {
  const plan = planCollapse(library, component, nodeId, id, sample)
  if (!plan) throw new Error(`${component}: ${nodeId} can't be collapsed`)
  const name = collapseName(library, component)
  return {
    plan,
    name,
    library: { ...library, [component]: plan.parent, [name]: plan.definition },
  }
}

/**
 * Collapse every node that can be collapsed, in every component, and check
 * that every component with sample data draws exactly what it drew before,
 * with no problem it didn't have.
 */
function expectEveryCollapseDrawsTheSame(
  where: string,
  library: Library,
  samples: Readonly<Record<string, Record<string, unknown>>>,
): number {
  const before = Object.fromEntries(
    Object.entries(samples).map(([name, data]) => [
      name,
      draw(library, name, data),
    ]),
  )
  let count = 0
  for (const [component, s] of Object.entries(library)) {
    for (const nodeId of Object.keys(s.nodes)) {
      if (collapseProblem(s, nodeId) !== undefined) continue
      count++
      const after = collapsed(library, component, nodeId).library
      for (const [name, data] of Object.entries(samples)) {
        const label = `${where}: ${component} ${nodeId}, drawing ${name}`
        const now = draw(after, name, data)
        expect(now.svg, label).toBe(before[name]!.svg)
        expect(now.compile.length, label).toBe(before[name]!.compile.length)
        expect(now.render.length, label).toBe(before[name]!.render.length)
      }
    }
  }
  return count
}

it("the scope panel names an each's bindings by the engine's rule", () => {
  const s = spec('scope001', {
    n0: { type: 'svg', children: ['n1'] },
    n1: {
      type: 'each',
      params: { list: '[1]', as: 'bad name', index: 'k' },
      children: ['n2'],
    },
    n2: { type: 'circle' },
  })
  const each = scopeAt(s, 'pic', 'n2')![0]!
  expect(each.label).toBe('each n1')
  // The engine binds `d` for an invalid name, so the panel says `d`.
  expect(each.vars.map((v) => v.name)).toEqual(['d', 'k'])
})

it('collapseProblem refuses the root, a lone instance and an unknown node, and accepts a subtree and a loose node', () => {
  const { card } = rich()
  const withLoose: ComponentSpec = {
    ...card,
    nodes: {
      ...card.nodes,
      n20: { type: 'g', children: ['n21'] },
      n21: { type: 'circle' },
    },
  }
  expect(collapseProblem(withLoose, 'n0')).toBe(
    'The root is the whole component; use Duplicate to copy it.',
  )
  expect(collapseProblem(withLoose, 'n11')).toBe(
    'It is already an instance of a component.',
  )
  expect(collapseProblem(withLoose, 'zz')).toBe('There is no node "zz".')
  expect(collapseProblem(withLoose, 'n2')).toBeUndefined()
  expect(collapseProblem(withLoose, 'n3')).toBeUndefined()
  expect(collapseProblem(withLoose, 'n20')).toBeUndefined()
  expect(collapseProblem(withLoose, 'n21')).toBeUndefined()
  // A broken graph (n3 also wired under n6) is refused until fixed.
  const shared: ComponentSpec = {
    ...card,
    nodes: { ...card.nodes, n6: { type: 'g', children: ['n7', 'n3'] } },
  }
  expect(collapseProblem(shared, 'n2')).toMatch(/wired somewhere else/)
})

it("collapse moves the subtree into the new definition and leaves one instance with the node's id, place and position", () => {
  const library = rich()
  const card: ComponentSpec = {
    ...library.card!,
    editor: {
      n0: { x: 600, y: 0 },
      n1: { x: 300, y: 0 },
      n2: { x: 0, y: 0 },
      n3: { x: -300, y: 0 },
      n4: { x: -300, y: 120 },
      n13: { x: -600, y: 120 },
      n5: { x: 300, y: 300 },
    },
  }
  const { plan } = collapsed({ ...library, card }, 'card', 'n2')

  // The parent: n2 is now an instance, in the same slot, at the same place.
  expect(plan.parent.nodes.n2).toEqual({
    type: 'component',
    ref: NEW_ID,
    params: { i: 'i', size: 'size', d: 'd', gap: 'gap', color: '=color' },
  })
  expect(plan.parent.nodes.n1!.children).toEqual(['n2'])
  for (const gone of ['n3', 'n4', 'n13']) {
    expect(plan.parent.nodes[gone]).toBeUndefined()
    expect(plan.parent.editor?.[gone]).toBeUndefined()
  }
  expect(plan.parent.editor?.n2).toEqual({ x: 0, y: 0 })
  expect(plan.parent.editor?.n5).toEqual({ x: 300, y: 300 })
  expect(plan.parent.root).toBe('n0')
  expect(plan.parent.id).toBe(card.id)
  // Everything else in the parent is untouched.
  for (const id of ['n0', 'n1', 'n5', 'n6', 'n7', 'n9', 'n10', 'n11', 'n12'])
    expect(plan.parent.nodes[id]).toBe(card.nodes[id])

  // The definition: the subtree as it was, ids, params and order included.
  expect(plan.definition.id).toBe(NEW_ID)
  expect(plan.definition.format).toBe(SPEC_FORMAT)
  expect(plan.definition.root).toBe('n2')
  expect(plan.definition.nodes).toEqual({
    n2: card.nodes.n2,
    n3: card.nodes.n3,
    n4: card.nodes.n4,
    n13: card.nodes.n13,
  })
  expect(plan.definition.editor).toEqual({
    n2: { x: 0, y: 0 },
    n3: { x: -300, y: 0 },
    n4: { x: -300, y: 120 },
    n13: { x: -600, y: 120 },
  })
})

it("collapsing a loose node leaves a loose instance with its id, and only the component's inputs become inputs", () => {
  const library = rich()
  const card: ComponentSpec = {
    ...library.card!,
    nodes: {
      ...library.card!.nodes,
      // Loose: nothing has n20 as a child. `d` would come from an each once
      // it is wired in; loose, it sees only the component's inputs.
      n20: { type: 'g', children: ['n21'] },
      n21: { type: 'circle', params: { r: 'size + d', fill: '=color' } },
    },
    editor: { n20: { x: -900, y: 500 }, n21: { x: -1200, y: 500 } },
  }
  const { plan } = collapsed({ ...library, card }, 'card', 'n20')
  expect(plan.definition.inputs).toEqual({
    size: { type: 'number' },
    color: { type: 'string' },
  })
  expect(plan.parent.nodes.n20).toEqual({
    type: 'component',
    ref: NEW_ID,
    params: { size: 'size', color: '=color' },
  })
  expect(plan.parent.nodes.n21).toBeUndefined()
  expect(
    Object.values(plan.parent.nodes).some((n) =>
      (n.children ?? []).includes('n20'),
    ),
  ).toBe(false)
  expect(plan.parent.editor?.n20).toEqual({ x: -900, y: 500 })
  expect(plan.definition.editor).toEqual({
    n20: { x: -900, y: 500 },
    n21: { x: -1200, y: 500 },
  })
})

it('collapse inputs are the variables used from outside: each, grid, component inputs and exposed names, not names bound inside', () => {
  const library = rich()
  // Under an each: its d and i, and the card's inputs. n4 rebinds d and i
  // for n13, but n4's own list reads the outer d.
  expect(Object.keys(collapseInputs(library, 'card', 'n2').inputs)).toEqual([
    'i',
    'size',
    'd',
    'gap',
    'color',
  ])
  // Collapsing the inner each n4: its list reads the outer d, but the i
  // its child reads is n4's own, though the outer each binds an i too.
  expect(Object.keys(collapseInputs(library, 'card', 'n4').inputs)).toEqual([
    'd',
  ])
  // Under a grid with renamed names.
  expect(Object.keys(collapseInputs(library, 'card', 'n6').inputs)).toEqual([
    'c',
    'r',
    'k',
    'color',
  ])
  // Collapsing the grid itself: c, r and k are bound inside.
  expect(Object.keys(collapseInputs(library, 'card', 'n5').inputs)).toEqual([
    'gap',
    'color',
  ])
  // Under an expose: op comes from outside.
  expect(Object.keys(collapseInputs(library, 'card', 'n10').inputs)).toEqual([
    'op',
    'size',
  ])
  // Collapsing the node that exposes it: op is bound inside.
  expect(
    Object.keys(collapseInputs(library, 'card', 'n9').inputs),
  ).not.toContain('op')
})

it('collapse inputs read every kind of param: numbers, lengths, lists, transform arguments, path and points holes, = strings and instance bindings', () => {
  const library = {
    badge: rich().badge!,
    kinds: spec(
      'kinds001',
      {
        n0: { type: 'svg', children: ['n1'] },
        n1: {
          type: 'g',
          children: ['n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'],
        },
        n2: {
          type: 'rect',
          params: { x: 'num', width: 'len %', height: 4, fill: 'red' },
        },
        n3: { type: 'each', params: { list: 'lst' } },
        n4: { type: 'g', params: { transform: 'translate(tx, 0)' } },
        n5: { type: 'path', params: { d: 'M 0 0 L {ph} 0' } },
        n6: { type: 'polygon', params: { points: '0,0 {pp},0 0,1' } },
        n7: { type: 'text', params: { text: '=str', 'font-family': 'lit' } },
        n8: {
          type: 'component',
          ref: 'badge001',
          params: { label: '=bind', r: 'rad' },
        },
      },
      Object.fromEntries(
        [
          'num',
          'len',
          'lst',
          'tx',
          'ph',
          'pp',
          'str',
          'lit',
          'red',
          'bind',
          'rad',
        ].map((name) => [name, { type: 'any' }]),
      ),
    ),
  }
  // `lit` and `red` are literal text, not reads.
  expect(Object.keys(collapseInputs(library, 'kinds', 'n1').inputs)).toEqual([
    'num',
    'len',
    'lst',
    'tx',
    'ph',
    'pp',
    'str',
    'bind',
    'rad',
  ])
})

it("collapse inputs leave out math constants, functions, helpers and names the surroundings don't define", () => {
  const library = rich()
  expect(collapseInputs(library, 'card', 'n12').inputs).toEqual({
    size: { type: 'number' },
    color: { type: 'string' },
  })
  // A name nothing outside defines stays as it is (undefined inside too).
  const card: ComponentSpec = {
    ...library.card!,
    nodes: {
      ...library.card!.nodes,
      n12: { type: 'text', params: { text: '=string(zz + sin(pi))' } },
    },
  }
  expect(collapseInputs({ ...library, card }, 'card', 'n12').inputs).toEqual({})
})

it('collapse inputs include a name an inner instance inherits from outside, unless the subtree binds it', () => {
  const library = rich()
  // n11 doesn't bind color, so it inherits the card's color; r is
  // inherited too, but nothing outside defines it, so its default applies.
  expect(collapseInputs(library, 'card', 'n9').inputs).toEqual({
    size: { type: 'number' },
    color: { type: 'string' },
  })
  // Bound on the instance: nothing inherited.
  const bound: ComponentSpec = {
    ...library.card!,
    nodes: {
      ...library.card!.nodes,
      n11: {
        type: 'component',
        ref: 'badge001',
        params: { label: 'hi', color: 'green' },
      },
    },
  }
  expect(
    Object.keys(
      collapseInputs({ ...library, card: bound }, 'card', 'n9').inputs,
    ),
  ).toEqual(['size'])
  // Bound inside the subtree (n9 exposes a `color`): nothing inherited
  // from outside.
  const exposed: ComponentSpec = {
    ...library.card!,
    nodes: {
      ...library.card!.nodes,
      n9: {
        ...library.card!.nodes.n9!,
        expose: { op: 'opacity', color: 'transform' },
      },
    },
  }
  expect(
    Object.keys(
      collapseInputs({ ...library, card: exposed }, 'card', 'n9').inputs,
    ),
  ).toEqual(['size'])
})

it("collapse copies an outer input's type, gives loop variables any, and binds string inputs with =", () => {
  const { plan } = collapsed(rich(), 'card', 'n2')
  expect(plan.definition.inputs).toEqual({
    i: { type: 'any' },
    size: { type: 'number' },
    d: { type: 'any' },
    gap: { type: 'number' },
    color: { type: 'string' },
  })
  // No default, no inherit: the instance always binds them.
  for (const decl of Object.values(plan.definition.inputs!)) {
    expect('default' in decl).toBe(false)
    expect('inherit' in decl).toBe(false)
  }
  expect(plan.parent.nodes.n2!.params).toEqual({
    i: 'i',
    size: 'size',
    d: 'd',
    gap: 'gap',
    color: '=color',
  })
  // An outer input with no type gives any.
  const library = rich()
  const card: ComponentSpec = {
    ...library.card!,
    inputs: { ...library.card!.inputs, size: { default: 10 } },
  }
  expect(
    collapseInputs({ ...library, card }, 'card', 'n12').inputs.size,
  ).toEqual({ type: 'any' })
})

it('collapsing any node of any example leaves every rendering unchanged', () => {
  const examples = join(import.meta.dirname, '../../examples')
  let count = 0
  for (const project of readdirSync(examples)) {
    const read = (folder: string, suffix: string) =>
      Object.fromEntries(
        readdirSync(join(examples, project, folder))
          .filter((f) => f.endsWith(suffix))
          .map((f) => [
            basename(f, suffix),
            JSON.parse(
              readFileSync(join(examples, project, folder, f), 'utf8'),
            ),
          ]),
      )
    const library = read('components', '.json') as Library
    const samples = read('samples', '.data.json') as Record<
      string,
      Record<string, unknown>
    >
    // The examples draw without problems, so "no new problem" means none.
    for (const [name, data] of Object.entries(samples)) {
      const drawn = draw(library, name, data)
      expect([...drawn.compile, ...drawn.render], name).toEqual([])
    }
    count += expectEveryCollapseDrawsTheSame(project, library, samples)
  }
  // The sweep covers every example's collapsible nodes (42 today).
  expect(count).toBeGreaterThanOrEqual(42)
})

it('collapsing inside each, grid and expose frames draws the same picture', () => {
  const library = rich()
  const before = draw(library, 'card', richSamples.card)
  expect([...before.compile, ...before.render]).toEqual([])
  // Every node of the card and the badge, including n2 (under an each, with
  // a rebound d inside), n6 (under a grid with renamed names), n10 (under
  // an expose) and n9 (holding an instance that inherits color).
  expect(
    expectEveryCollapseDrawsTheSame('rich', library, richSamples),
  ).toBeGreaterThanOrEqual(13)
  // And the nested case: collapse n2, then collapse inside the new part.
  const once = collapsed(library, 'card', 'n2')
  const twice = collapsed(once.library, once.name, 'n4', {}, 'c0ffee01')
  expect(draw(twice.library, 'card', richSamples.card).svg).toBe(before.svg)
  expect(twice.plan.definition.inputs).toEqual({ d: { type: 'any' } })
})

it('collapseName suggests the component name with -part, then the next free number', () => {
  expect(collapseName({ deck: 1 }, 'deck')).toBe('deck-part')
  expect(collapseName({ deck: 1, 'deck-part': 1 }, 'deck')).toBe('deck-part-2')
  expect(
    collapseName({ deck: 1, 'deck-part': 1, 'deck-part-2': 1 }, 'deck'),
  ).toBe('deck-part-3')
  // Never longer than a name may be: a long component name is cut.
  const long = 'x'.repeat(64)
  expect(collapseName({ [long]: 1 }, long)).toBe(`${'x'.repeat(59)}-part`)
  expect(collapseName({ [long]: 1, [`${'x'.repeat(59)}-part`]: 1 }, long)).toBe(
    `${'x'.repeat(57)}-part-2`,
  )
})

it('collapse inside an entered definition leaves the trail intact', () => {
  const library = {
    ...rich(),
    stage: spec('stage001', {
      n0: { type: 'svg', children: ['n1'] },
      n1: { type: 'component', ref: 'card0001', params: { gap: 2 } },
    }),
  }
  const trail: Trail = [
    { component: 'stage' },
    { component: 'card', via: 'n1' },
  ]
  const after = collapsed(library, 'card', 'n2').library
  expect(settleTrail(trail, { name: 'p', library: after })).toEqual(trail)
  // The stage still draws the same.
  expect(draw(after, 'stage', {}).svg).toBe(draw(library, 'stage', {}).svg)
})

it("the new component's sample holds the sample value or else the default of each new input that is an input of the containing component, and nothing for loop variables", () => {
  const library = rich()
  // gap from the card's sample; size and color from their defaults; i and d
  // are loop variables; items isn't used.
  expect(
    collapsed(library, 'card', 'n2', richSamples.card).plan.sample,
  ).toEqual({ size: 10, gap: 4, color: '#cc3333' })
  // A sample value wins over the default.
  expect(collapseSample(library.card!, { size: 3 }, ['size', 'color'])).toEqual(
    { size: 3, color: '#cc3333' },
  )
  // An input with neither gets nothing.
  expect(collapseSample(library.card!, {}, ['gap'])).toBeUndefined()
  // Loop variables only: no sample.
  expect(
    collapsed(library, 'card', 'n13', richSamples.card).plan.sample,
  ).toBeUndefined()
})

it('collapse writes no sample file when no new input has a value', () => {
  const library = rich()
  const project: Project = {
    root: 'projects',
    name: 'p',
    readOnly: false,
    library,
    samples: { card: richSamples.card },
    unsaved: [],
    removed: [],
    onDisk: true,
    problems: [],
  }
  // n13 reads only d and i, both loop variables: no values to copy.
  const outcome = collapseToComponent(project, 'card', 'n13', 'card-part')
  if ('error' in outcome) throw new Error(outcome.error)
  const after = outcome.project
  expect(after.library['card-part']).toBeDefined()
  expect(Object.hasOwn(after.samples, 'card-part')).toBe(false)
  expect([...after.unsaved].sort()).toEqual([
    'components/card',
    'components/card-part',
  ])
  // With a value to copy (n12 reads size and color), the sample is written.
  const other = collapseToComponent(project, 'card', 'n12', 'card-part')
  if ('error' in other) throw new Error(other.error)
  expect(other.project.samples['card-part']).toEqual({
    size: 10,
    color: '#cc3333',
  })
  expect(other.project.unsaved).toContain('samples/card-part')
})

it('collapsing carries a vars node inside and turns a vars name above into an input', () => {
  // half is read by twice from the same vars node; twice and half are read
  // below it.
  const library: Library = {
    card: spec(
      'aaaa0050',
      {
        n0: { type: 'svg', children: ['n1'] },
        n1: {
          type: 'vars',
          vars: { half: 'size / 2', twice: 'half * 2 + gap' },
          children: ['n2', 'n3'],
        },
        n2: { type: 'g', children: ['n4'] },
        n4: { type: 'circle', params: { r: 'twice' } },
        n3: { type: 'rect', params: { width: 'half', height: 1 } },
      },
      {
        size: { type: 'number', default: 10 },
        gap: { type: 'number', default: 1 },
        // An outer half too, which the vars node's half hides below it: only
        // the rule that a vars node binds its names keeps it from becoming
        // an input when the vars node is collapsed.
        half: { type: 'number', default: 99 },
      },
    ),
  }
  const sample = { size: 10, gap: 1, half: 99 }
  const before = draw(library, 'card', sample)
  expect([...before.compile, ...before.render]).toEqual([])
  expect(before.svg).toContain('<circle r="11" />')

  // Inside: the vars node moves with the subtree, its names stay bound
  // inside, and half (read from an earlier name of the same node) isn't an
  // input; only what its values read from outside is.
  const inside = collapsed(library, 'card', 'n1', sample)
  expect(inside.plan.definition.nodes.n1).toEqual(library.card!.nodes.n1)
  expect(inside.plan.definition.inputs).toEqual({
    size: { type: 'number' },
    gap: { type: 'number' },
  })
  expect(draw(inside.library, 'card', sample).svg).toBe(before.svg)

  // Above: a name a vars node above defines becomes an input (any type,
  // not from the component's inputs), bound at the instance.
  expect(collapseInputs(library, 'card', 'n2')).toEqual({
    inputs: { twice: { type: 'any' } },
    fromComponent: [],
  })
  expect(Object.keys(collapseInputs(library, 'card', 'n3').inputs)).toEqual([
    'half',
  ])
  const above = collapsed(library, 'card', 'n2', sample)
  expect(above.plan.parent.nodes.n2!.params).toEqual({ twice: 'twice' })
  expect(draw(above.library, 'card', sample).svg).toBe(before.svg)

  // And every collapse of this card draws the same picture.
  expect(
    expectEveryCollapseDrawsTheSame('vars', library, { card: sample }),
  ).toBeGreaterThanOrEqual(4)
})
