// Node labels in the editor (#59): the card title, the inspector's Label
// field, Collapse's suggested name, problems named by label, find node, and
// labels kept through Make unique, Collapse and Export for player.

import { expect, it } from 'vitest'
import {
  compile,
  nodeLabel,
  SPEC_FORMAT,
  toSvgString,
} from '@hackensack/engine'
import type { ComponentSpec, Diagnostic, Library } from '@hackensack/engine'
import { collapseName, labelStem } from './collapse.ts'
import { describeLocation, labelsIn, nodeName } from './diagnostics.ts'
import { setLabel } from './edit.ts'
import { exportBundle } from './exportBundle.ts'
import { nodeHeight, specToFlow } from './layout.ts'
import {
  collapseToComponent,
  editComponent,
  makeUnique,
  redoProject,
  sealProject,
  undoProject,
} from './projectHistory.ts'
import { duplicateComponent, fromFiles } from './projects.ts'
import type { Outcome, Project } from './projects.ts'

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

/** A labelled `dot` definition, and `card()` with a labelled instance of it. */
function withDot(): Record<string, ComponentSpec> {
  const spec = card()
  spec.nodes.n0.children = [...spec.nodes.n0.children!, 'n5']
  spec.nodes.n5 = { type: 'component', label: 'left dot', ref: 'c0000002' }
  return {
    card: spec,
    dot: {
      format: SPEC_FORMAT,
      id: 'c0000002',
      root: 'm0',
      nodes: {
        m0: { type: 'g', label: 'dot group', children: ['m1'] },
        m1: { type: 'circle', label: 'dot', params: { r: 3 } },
      },
    },
  }
}

/** A project holding `card()` as `card` (or the given components). */
function project(
  components: Record<string, ComponentSpec> = { card: card() },
): Project {
  return fromFiles({
    root: 'projects',
    name: 'labels',
    readOnly: false,
    components,
    samples: {},
    problems: [],
  })
}

const done = (outcome: Outcome): Project => {
  if ('error' in outcome) throw new Error(outcome.error)
  return outcome.project
}

/** Every node's label, by component and node id, read with nodeLabel. */
const labelsOf = (library: Library) =>
  Object.fromEntries(
    Object.entries(library).map(([name, spec]) => [
      name,
      Object.fromEntries(
        Object.entries(spec.nodes).map(([id, n]) => [id, nodeLabel(n)]),
      ),
    ]),
  )

const drawn = (library: Library, name: string) => {
  const program = compile(name, library)
  return toSvgString(program.render({}).output)
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

it("collapseName suggests a valid, free name from the label and falls back to the component's part name", () => {
  const library = { card: {}, cloud: {}, 'cloud-2': {} }
  expect(collapseName({ card: {} }, 'card', 'cloud')).toBe('cloud')
  expect(collapseName(library, 'card', 'cloud')).toBe('cloud-3')
  expect(collapseName({}, 'card', 'Left blade')).toBe('left-blade')
  expect(collapseName({}, 'card', '  Big   Sun!! ')).toBe('big-sun')
  expect(collapseName({}, 'card', '7')).toBe('7')
  expect(collapseName({}, 'card', '_rain_ drop_')).toBe('rain_-drop')
  // Too long: cut to 64, with room for a number when the name is taken.
  const long = 'x'.repeat(80)
  expect(collapseName({}, 'card', long)).toBe('x'.repeat(64))
  expect(collapseName({ ['x'.repeat(64)]: {} }, 'card', long)).toBe(
    `${'x'.repeat(62)}-2`,
  )
  // Nothing usable in the label, or no label: the part name, as before.
  expect(collapseName({}, 'card', '!!!')).toBe('card-part')
  expect(collapseName({}, 'card', 'é')).toBe('card-part')
  expect(collapseName({}, 'card')).toBe('card-part')
  expect(collapseName({ 'card-part': {} }, 'card')).toBe('card-part-2')
  // Every suggestion is a valid name.
  for (const label of ['Left blade', '  Big   Sun!! ', '_rain_ drop_', long])
    expect(labelStem(label)).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
})

it('make unique and duplicateComponent keep every label, read back with nodeLabel', () => {
  const p = project(withDot())
  const before = labelsOf(p.library)
  const copied = done(duplicateComponent(p, 'dot', 'dot-copy'))
  expect(labelsOf(copied.library)['dot-copy']).toEqual(before.dot)
  expect(nodeLabel(copied.library['dot-copy'].nodes.m1)).toBe('dot')
  const unique = done(makeUnique(p, 'card', 'n5', 'dot-2'))
  const after = labelsOf(unique.library)
  expect(after['dot-2']).toEqual(before.dot)
  // The repointed instance keeps its own label, and the card the rest.
  expect(after.card).toEqual(before.card)
  expect(nodeLabel(unique.library.card.nodes.n5)).toBe('left dot')
  expect(unique.library.card.nodes.n5.ref).toBe(unique.library['dot-2'].id)
})

it("collapse keeps the label on the new instance and on the definition's root, and renders unchanged", () => {
  const p = project(withDot())
  const picture = drawn(p.library, 'card')
  const collapsed = done(collapseToComponent(p, 'card', 'n3', 'clouds'))
  const { card: parent, clouds } = collapsed.library
  expect(parent.nodes.n3.type).toBe('component')
  expect(nodeLabel(parent.nodes.n3)).toBe('clouds')
  expect(nodeLabel(clouds.nodes[clouds.root])).toBe('clouds')
  expect(nodeLabel(clouds.nodes.n4)).toBe('7')
  expect(drawn(collapsed.library, 'card')).toBe(picture)
  // A node without a label collapses into an instance without one.
  const plain = done(collapseToComponent(p, 'card', 'n2', 'strip'))
  expect('label' in plain.library.card.nodes.n2).toBe(false)
})

it('exportBundle keeps every node label, read back with nodeLabel, including unsaved edits', () => {
  let p = project(withDot())
  // An unsaved edit: a new label on the rect, and one changed in dot.
  p = editComponent(p, 'card', (s) => setLabel(s, 'n2', 'ground'))
  p = editComponent(p, 'dot', (s) => setLabel(s, 'm1', 'tiny dot'))
  const exported = JSON.parse(exportBundle(p, 'card').text) as {
    components: Library
  }
  expect(labelsOf(exported.components)).toEqual(labelsOf(p.library))
  expect(nodeLabel(exported.components.card.nodes.n2)).toBe('ground')
  expect(nodeLabel(exported.components.dot.nodes.m1)).toBe('tiny dot')
  expect(nodeLabel(exported.components.card.nodes.n5)).toBe('left dot')
})

it('describeLocation names a labelled node by its label and keeps its id, and an unlabelled node as before', () => {
  const library = withDot()
  const labelOf = labelsIn(library)
  const at = (d: Partial<Diagnostic>) =>
    describeLocation({ component: 'card', message: 'oops', ...d }, labelOf)
  expect(at({ node: 'n1', param: 'r' })).toBe('card · sun (n1).r')
  expect(at({ node: 'n1' })).toBe('card · sun (n1)')
  expect(at({ node: 'n4', param: 'rx' })).toBe('card · 7 (n4).rx')
  expect(at({ component: 'dot', node: 'm1', param: 'r', path: ['n5'] })).toBe(
    'dot via n5 · dot (m1).r',
  )
  // No label: as before, with or without the lookup.
  expect(at({ node: 'n2', param: 'width' })).toBe('card · n2.width')
  expect(
    describeLocation({ component: 'card', node: 'n2', message: 'x' }),
  ).toBe('card · n2')
  // Without the lookup, a labelled node reads as before too.
  expect(
    describeLocation({
      component: 'card',
      node: 'n1',
      param: 'r',
      message: 'x',
    }),
  ).toBe('card · n1.r')
  // A param-only or node-less problem, and a node or component that's gone.
  expect(at({ param: 'xs' })).toBe('card · xs')
  expect(at({})).toBe('card')
  expect(at({ node: 'gone' })).toBe('card · gone')
  expect(at({ component: 'nowhere', node: 'n1' })).toBe('nowhere · n1')
  expect(nodeName(library.card, 'n1')).toBe('sun (n1)')
  expect(nodeName(library.card, 'n2')).toBe('n2')
  expect(nodeName(undefined, 'n2')).toBe('n2')
})

it('make unique and collapse refusals name a labelled node by its label and id, and an unlabelled one as before', () => {
  const lib = withDot()
  // An instance with no ref, and one with a missing definition.
  lib.card.nodes.n0.children = [...lib.card.nodes.n0.children!, 'n6', 'n7']
  lib.card.nodes.n6 = { type: 'component', label: 'empty slot' }
  lib.card.nodes.n7 = { type: 'component', label: 'lost dot', ref: 'ffff0000' }
  lib.card.nodes.n8 = { type: 'component' }
  const p = project(lib)
  const error = (outcome: Outcome) =>
    'error' in outcome ? outcome.error : 'no error'
  expect(error(makeUnique(p, 'card', 'n1', 'x'))).toBe(
    "sun (n1) isn't an instance of a component.",
  )
  expect(error(makeUnique(p, 'card', 'n2', 'x'))).toBe(
    "n2 isn't an instance of a component.",
  )
  expect(error(makeUnique(p, 'card', 'n6', 'x'))).toBe(
    'empty slot (n6) has no definition to copy.',
  )
  expect(error(makeUnique(p, 'card', 'n8', 'x'))).toBe(
    'n8 has no definition to copy.',
  )
  expect(error(makeUnique(p, 'card', 'n7', 'x'))).toBe(
    "lost dot (n7)'s definition is missing, so there is nothing to copy.",
  )
  // The root can't be collapsed; a labelled root is named by its label.
  const labelledRoot = project({
    ...lib,
    card: {
      ...lib.card,
      nodes: {
        ...lib.card.nodes,
        n0: { ...lib.card.nodes.n0, label: 'whole card' },
      },
    },
  })
  expect(error(collapseToComponent(labelledRoot, 'card', 'n0', 'x'))).toMatch(
    /^Can't collapse whole card \(n0\): /,
  )
  expect(error(collapseToComponent(p, 'card', 'n0', 'x'))).toMatch(
    /^Can't collapse n0: /,
  )
  // A lone instance can't be collapsed either.
  expect(error(collapseToComponent(p, 'card', 'n5', 'x'))).toMatch(
    /^Can't collapse left dot \(n5\): /,
  )
})
