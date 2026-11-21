// Node labels in the editor (#59): the card title, the inspector's Label
// field, Collapse's suggested name, problems named by label, find node, and
// labels kept through Make unique, Collapse and Export for player.

import { expect, it } from 'vitest'
import { SPEC_FORMAT } from '@hackensack/engine'
import type { ComponentSpec } from '@hackensack/engine'
import { nodeHeight, specToFlow } from './layout.ts'

/** A small card: a labelled circle, an unlabelled rect, a labelled group. */
function card(): ComponentSpec {
  return {
    format: SPEC_FORMAT,
    id: 'c0000001',
    root: 'n0',
    nodes: {
      n0: {
        type: 'svg',
        params: { width: 100, height: 100 },
        children: ['n1', 'n2', 'n3'],
      },
      n1: { type: 'circle', label: 'sun', params: { cx: 20, cy: 20, r: 8 } },
      n2: { type: 'rect', params: { width: 100, height: 10 } },
      n3: { type: 'g', label: 'clouds', children: ['n4'] },
      n4: { type: 'ellipse', label: 7, params: { rx: 10, ry: 4 } },
    },
  }
}

it("specToFlow gives a labelled node its label, leaves an unlabelled node's data as it was, and gives both the same card height", () => {
  const labelled = card()
  const plain = structuredClone(labelled)
  for (const node of Object.values(plain.nodes)) delete node.label
  const byId = (spec: ComponentSpec) =>
    new Map(specToFlow(spec).nodes.map((n) => [n.id, n.data]))
  const withLabels = byId(labelled)
  const without = byId(plain)
  expect(withLabels.get('n1')?.label).toBe('sun')
  expect(withLabels.get('n3')?.label).toBe('clouds')
  expect(withLabels.get('n4')?.label).toBe('7')
  // An unlabelled node's data has no label key at all: exactly as before.
  expect('label' in withLabels.get('n2')!).toBe(false)
  expect(withLabels.get('n2')).toEqual(without.get('n2'))
  for (const [id, data] of without) {
    expect('label' in data).toBe(false)
    const rest = { ...withLabels.get(id)! }
    delete rest.label
    expect(rest, id).toEqual(data)
    expect(nodeHeight(withLabels.get(id)!), id).toBe(nodeHeight(data))
  }
})
