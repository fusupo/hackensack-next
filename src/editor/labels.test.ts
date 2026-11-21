// Node labels in the editor (#59): the card title, the inspector's Label
// field, Collapse's suggested name, problems named by label, find node, and
// labels kept through Make unique, Collapse and Export for player.

import { expect, it } from 'vitest'
import { SPEC_FORMAT } from '@hackensack/engine'
import type { ComponentSpec } from '@hackensack/engine'
import { setLabel } from './edit.ts'
import { nodeHeight, specToFlow } from './layout.ts'
import {
  editComponent,
  redoProject,
  sealProject,
  undoProject,
} from './projectHistory.ts'
import { fromFiles } from './projects.ts'
import type { Project } from './projects.ts'

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

/** A project holding `card()` as `card`. */
function project(): Project {
  return fromFiles({
    root: 'projects',
    name: 'labels',
    readOnly: false,
    components: { card: card() },
    samples: {},
    problems: [],
  })
}

it("setLabel sets, replaces and removes a label and leaves the node's other fields", () => {
  const spec = card()
  const set = setLabel(spec, 'n2', 'ground')
  expect(set.nodes.n2).toEqual({ ...spec.nodes.n2, label: 'ground' })
  const replaced = setLabel(set, 'n2', 'grass')
  expect(replaced.nodes.n2).toEqual({ ...spec.nodes.n2, label: 'grass' })
  // Stored as typed: a space typed mid-word survives.
  expect(setLabel(spec, 'n1', 'left ').nodes.n1.label).toBe('left ')
  // Blank text removes the key altogether.
  for (const blank of ['', '   ']) {
    const removed = setLabel(spec, 'n1', blank)
    expect('label' in removed.nodes.n1).toBe(false)
    expect(removed.nodes.n1).toEqual({
      type: 'circle',
      params: { cx: 20, cy: 20, r: 8 },
    })
  }
  // Other nodes and the input spec are untouched.
  expect(set.nodes.n1).toBe(spec.nodes.n1)
  expect(spec.nodes.n2.label).toBeUndefined()
  // A node's children and params survive a label edit.
  expect(setLabel(spec, 'n3', 'sky').nodes.n3).toEqual({
    type: 'g',
    label: 'sky',
    children: ['n4'],
  })
})

it('label edits merge into one history step per field visit and undo restores the old label', () => {
  const type = (p: Project, text: string) =>
    editComponent(p, 'card', (s) => setLabel(s, 'n1', text), 'label:n1')
  let p = project()
  for (const text of ['m', 'mo', 'moo', 'moon']) p = type(p, text)
  expect(p.history!.past).toHaveLength(1)
  expect(p.library.card.nodes.n1.label).toBe('moon')
  // Leaving the field ends the visit: typing again is a second step.
  p = type(sealProject(p), 'moon!')
  expect(p.history!.past).toHaveLength(2)
  const once = undoProject(p)!.project
  expect(once.library.card.nodes.n1.label).toBe('moon')
  const twice = undoProject(once)!.project
  expect(twice.library.card.nodes.n1.label).toBe('sun')
  const redone = redoProject(twice)!.project
  expect(redone.library.card.nodes.n1.label).toBe('moon')
})
