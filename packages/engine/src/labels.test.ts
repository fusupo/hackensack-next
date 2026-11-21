// Node labels (#59): an optional `label` on any node names what it stands for
// in the picture. Drawing ignores it; `nodeLabel` reads it; `compile` reports
// one that isn't text.

import { expect, it } from 'vitest'
import {
  bundle,
  compile,
  nodeLabel,
  readBundle,
  SPEC_FORMAT,
  toSvgString,
} from './index.ts'
import type { ComponentSpec, Library, NodeSpec } from './index.ts'

/** A card using every kind of node: shapes, a group, each, grid, vars, an
 * instance and an animation. `label` gives each node its label (or none). */
function library(label: (id: string) => unknown = () => undefined): Library {
  const nodes: Record<string, NodeSpec> = {
    n0: {
      type: 'svg',
      params: { width: 100, height: 100 },
      children: ['n1', 'n2', 'n4', 'n6', 'n8', 'n10'],
    },
    n1: { type: 'rect', params: { width: 100, height: 100, fill: '#eee' } },
    n2: {
      type: 'g',
      params: { transform: 'translate(5, 5)' },
      children: ['n3'],
    },
    n3: {
      type: 'circle',
      params: { cx: 10, cy: 10, r: 5 },
      children: ['n11'],
    },
    n4: { type: 'each', params: { list: 'xs' }, children: ['n5'] },
    n5: { type: 'rect', params: { x: 'd * 10', width: 5, height: 5 } },
    n6: { type: 'grid', params: { count: 3 }, children: ['n7'] },
    n7: { type: 'circle', params: { r: 2 } },
    n8: { type: 'vars', vars: { half: '50' }, children: ['n9'] },
    n9: { type: 'line', params: { x1: 0, y1: 'half', x2: 100, y2: 'half' } },
    n10: { type: 'component', ref: 'd0000002' },
    n11: {
      type: 'animate',
      params: { attributeName: 'r', from: '5', to: '8', dur: 2 },
    },
  }
  for (const [id, node] of Object.entries(nodes)) {
    const value = label(id)
    if (value !== undefined) (node as { label?: unknown }).label = value
  }
  const dot: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'd0000002',
    root: 'm0',
    nodes: { m0: { type: 'circle', params: { r: 1 } } },
  }
  const dotLabel = label('m0')
  if (dotLabel !== undefined)
    (dot.nodes.m0 as { label?: unknown }).label = dotLabel
  return {
    card: {
      format: SPEC_FORMAT,
      id: 'd0000001',
      inputs: { xs: { type: 'list' } },
      root: 'n0',
      nodes,
    },
    dot,
  }
}

const DATA = { xs: [1, 2, 3] }

function draw(lib: Library) {
  const program = compile('card', lib)
  const { output, errors } = program.render(DATA)
  return { svg: toSvgString(output), errors: [...program.errors, ...errors] }
}

it('labels on every kind of node are read by nodeLabel and leave the SVG byte for byte the same', () => {
  const plain = draw(library())
  expect(plain.errors).toEqual([])
  const labelled = library((id) => `part ${id}`)
  for (const spec of Object.values(labelled))
    for (const [id, node] of Object.entries(spec.nodes))
      expect(nodeLabel(node)).toBe(`part ${id}`)
  const drawn = draw(labelled)
  expect(drawn.errors).toEqual([])
  expect(drawn.svg).toBe(plain.svg)
  expect(drawn.svg).not.toContain('part ')
  expect(drawn.svg).not.toContain('label')
})

it('nodeLabel reads text and numbers as text and treats missing, null, empty and blank as no label', () => {
  const read = (label: unknown) => nodeLabel({ label })
  expect(read('cloud')).toBe('cloud')
  expect(read('  left blade ')).toBe('left blade')
  expect(read(3)).toBe('3')
  expect(read(2.5)).toBe('2.5')
  expect(read(0)).toBe('0')
  expect(read(-1)).toBe('-1')
  expect(nodeLabel({})).toBeUndefined()
  expect(nodeLabel(undefined)).toBeUndefined()
  expect(read(undefined)).toBeUndefined()
  expect(read(null)).toBeUndefined()
  expect(read('')).toBeUndefined()
  expect(read('   ')).toBeUndefined()
  // Not text: no label (compile reports these).
  expect(read(['a'])).toBeUndefined()
  expect(read({ text: 'a' })).toBeUndefined()
  expect(read(true)).toBeUndefined()
  expect(read(false)).toBeUndefined()
})

it('a label that is a list, an object or a boolean is a problem on that node, and the picture still draws', () => {
  const bad: Record<string, unknown> = {
    n1: ['sky'],
    n5: { name: 'bar' },
    n9: true,
    m0: false,
  }
  const plain = draw(library())
  const drawn = draw(library((id) => bad[id]))
  const labelProblems = drawn.errors.filter((e) =>
    e.message.startsWith('label must be text'),
  )
  expect(
    labelProblems.map((e) => [e.component, e.node, e.param, e.message]),
  ).toEqual([
    ['card', 'n1', undefined, 'label must be text, not a list'],
    ['card', 'n5', undefined, 'label must be text, not an object'],
    ['card', 'n9', undefined, 'label must be text, not true'],
    ['dot', 'm0', undefined, 'label must be text, not false'],
  ])
  // Nothing else is reported, and the picture is the same.
  expect(drawn.errors).toHaveLength(4)
  expect(drawn.svg).toBe(plain.svg)
})

it('a node without a label adds no problem, and a text or number label is read by nodeLabel and adds none', () => {
  expect(draw(library()).errors).toEqual([])
  const values: Record<string, unknown> = {
    n1: 'sky',
    n3: 7,
    n5: 1.5,
    n7: '',
    n9: null,
    m0: '  dot ',
  }
  const lib = library((id) => values[id])
  expect(draw(lib).errors).toEqual([])
  expect(nodeLabel(lib.card.nodes.n1)).toBe('sky')
  expect(nodeLabel(lib.card.nodes.n3)).toBe('7')
  expect(nodeLabel(lib.card.nodes.n5)).toBe('1.5')
  expect(nodeLabel(lib.card.nodes.n7)).toBeUndefined()
  expect(nodeLabel(lib.card.nodes.n9)).toBeUndefined()
  expect(nodeLabel(lib.dot.nodes.m0)).toBe('dot')
})

it("a loose node's label is not checked until the node is wired in, then a bad one is reported once", () => {
  const lib = library()
  const card = lib.card
  // A loose node (not under the root) with a bad label: not compiled, so
  // not checked.
  card.nodes.loose = {
    type: 'rect',
    params: { width: 1, height: 1 },
    label: ['loose'] as unknown as string,
  }
  const looseProblems = (errors: { node?: string; message: string }[]) =>
    errors.filter((e) => e.node === 'loose')
  const before = draw(lib).errors
  expect(looseProblems(before).map((e) => e.message)).not.toContain(
    'label must be text, not a list',
  )
  // Wired in under the root, it is reported, once.
  card.nodes.n0.children = [...(card.nodes.n0.children ?? []), 'loose']
  const after = draw(lib).errors
  expect(looseProblems(after).map((e) => e.message)).toEqual([
    'label must be text, not a list',
  ])
})

it('bundle keeps every node label, read back with nodeLabel, and readBundle accepts a labelled bundle', () => {
  const lib = library((id) => (id === 'n5' ? 4 : `part ${id}`))
  const made = bundle('card', lib, DATA)
  const read = readBundle(JSON.parse(JSON.stringify(made)))
  expect(read.problems).toBeUndefined()
  const components = read.bundle!.components
  for (const [name, spec] of Object.entries(lib))
    for (const [id, node] of Object.entries(spec.nodes))
      expect(nodeLabel(components[name].nodes[id])).toBe(nodeLabel(node))
  expect(nodeLabel(components.card.nodes.n5)).toBe('4')
  expect(nodeLabel(components.dot.nodes.m0)).toBe('part m0')
})
