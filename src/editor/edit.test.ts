import { describe, expect, it } from 'vitest'
import { compile, SPEC_FORMAT, toSvgString } from '../engine/index.ts'
import type { ComponentSpec } from '../engine/index.ts'
import {
  addNode,
  connect,
  connectProblem,
  deleteNodes,
  disconnect,
  freezeLayout,
  moveNodes,
  nextNodeId,
  parseParamInput,
  renameInput,
  setInput,
  setParam,
  setRef,
  setRoot,
} from './edit.ts'
import {
  addComponent,
  blankComponent,
  duplicateProject,
  markSaved,
  newProject,
  setSample,
  updateComponent,
  withMissingInputs,
} from './projects.ts'
import { scopeAt } from './scope.ts'

const base = (): ComponentSpec => ({
  format: SPEC_FORMAT,
  inputs: { l: { type: 'list' } },
  root: 'n0',
  nodes: {
    n0: { type: 'svg', children: ['n1'] },
    n1: { type: 'g', children: ['n2', 'n3'] },
    n2: { type: 'rect' },
    n3: { type: 'circle' },
    n9: { type: 'g' },
  },
})
const kids = (spec: ComponentSpec, id: string) => spec.nodes[id]!.children ?? []

describe('editing a spec', () => {
  it('adds unconnected nodes with fresh ids and a position', () => {
    const { spec, id } = addNode(base(), 'component', { x: 1, y: 2 }, 'sun')
    expect(id).toBe('n10')
    expect(spec.nodes.n10).toEqual({ type: 'component', ref: 'sun' })
    expect(spec.editor).toEqual({ n10: { x: 1, y: 2 } })
    expect(nextNodeId({ ...base(), nodes: { a: { type: 'g' } } })).toBe('n0')
  })

  it('plugs a child into a slot, inserting before what is there', () => {
    expect(kids(connect(base(), 'n9', 'n1', 0), 'n1')).toEqual([
      'n9',
      'n2',
      'n3',
    ])
    expect(kids(connect(base(), 'n9', 'n1', 2), 'n1')).toEqual([
      'n2',
      'n3',
      'n9',
    ])
  })

  it('moves a child that already has a parent, including within the same parent', () => {
    const moved = connect(base(), 'n3', 'n0', 0)
    expect(kids(moved, 'n0')).toEqual(['n3', 'n1'])
    expect(kids(moved, 'n1')).toEqual(['n2'])
    expect(kids(connect(base(), 'n2', 'n1', 2), 'n1')).toEqual(['n3', 'n2'])
  })

  it('refuses connections that would break the tree', () => {
    expect(connectProblem(base(), 'n9', 'n2')).toBe(
      "a rect node can't have children",
    )
    expect(connectProblem(base(), 'n0', 'n9')).toBe(
      "the root can't go inside another node",
    )
    expect(connectProblem(base(), 'n1', 'n1')).toBe(
      "a node can't go inside itself",
    )
    expect(connectProblem(base(), 'n1', 'n3')).toBe(
      "a circle node can't have children",
    )
    expect(connectProblem(connect(base(), 'n9', 'n1', 0), 'n1', 'n9')).toBe(
      "a node can't go inside itself",
    )
    const spec = base()
    expect(connect(spec, 'n0', 'n9', 0)).toBe(spec)
  })

  it('unplugs and deletes, keeping orphans and never deleting the root', () => {
    expect(kids(disconnect(base(), 'n1', 0), 'n1')).toEqual(['n3'])
    const deleted = deleteNodes(moveNodes(base(), { n1: { x: 0, y: 0 } }), [
      'n1',
      'n0',
    ])
    expect(Object.keys(deleted.nodes)).toEqual(['n0', 'n2', 'n3', 'n9'])
    expect(kids(deleted, 'n0')).toEqual([])
    expect(deleted.editor).toEqual({})
  })

  it('changes the root, unplugging the new one from its parent', () => {
    const spec = setRoot(base(), 'n1')
    expect(spec.root).toBe('n1')
    expect(kids(spec, 'n0')).toEqual([])
  })

  it('sets and removes params, and reads typed values by kind', () => {
    const spec = setParam(
      setParam(base(), 'n2', 'width', 20),
      'n2',
      'fill',
      '#fff',
    )
    expect(spec.nodes.n2!.params).toEqual({ width: 20, fill: '#fff' })
    expect(setParam(spec, 'n2', 'width', undefined).nodes.n2!.params).toEqual({
      fill: '#fff',
    })
    expect(parseParamInput('length', ' 12.5 ')).toBe(12.5)
    expect(parseParamInput('length', 'd * 4')).toBe('d * 4')
    expect(parseParamInput('color', '12')).toBe('12')
    expect(parseParamInput('number', '')).toBeUndefined()
    expect(setRef(base(), 'n9', 'sun').nodes.n9!.ref).toBe('sun')
  })

  it('edits inputs, keeping their order on rename', () => {
    const spec = setInput(setInput(base(), 'cy', { type: 'number' }), 'c', {
      type: 'string',
      inherit: true,
    })
    expect(Object.keys(renameInput(spec, 'l', 'list').inputs!)).toEqual([
      'list',
      'cy',
      'c',
    ])
    expect(renameInput(spec, 'l', 'cy')).toBe(spec) // name taken
    expect(Object.keys(setInput(spec, 'cy', undefined).inputs!)).toEqual([
      'l',
      'c',
    ])
  })

  it('saves positions for nodes that lack one', () => {
    const spec = moveNodes(base(), { n0: { x: 9, y: 9 } })
    const frozen = freezeLayout(
      spec,
      new Map([
        ['n0', { x: 0, y: 0 }],
        ['n1', { x: -300, y: 0 }],
      ]),
    )
    expect(frozen.editor).toEqual({ n0: { x: 9, y: 9 }, n1: { x: -300, y: 0 } })
  })
})

describe('scope panel', () => {
  const spec: ComponentSpec = {
    format: SPEC_FORMAT,
    inputs: {
      l: { type: 'list' },
      d: { type: 'number', default: 3 },
      tone: { type: 'string', inherit: true },
    },
    root: 'n0',
    nodes: {
      n0: {
        type: 'svg',
        params: { width: 300 },
        expose: { w: 'width' },
        children: ['n1'],
      },
      n1: { type: 'each', params: { list: 'l' }, children: ['n2'] },
      n2: { type: 'rect' },
      lost: { type: 'circle' },
    },
  }

  it('lists frames nearest first and marks shadowed names', () => {
    expect(scopeAt(spec, 'pic', 'n2', { l: [1, 2] })).toEqual([
      {
        label: 'each n1',
        vars: [
          { name: 'd', detail: 'one item of l', shadowed: false },
          {
            name: 'i',
            detail: "that item's position, from 0",
            shadowed: false,
          },
        ],
      },
      {
        label: 'exposed by svg n0',
        vars: [{ name: 'w', detail: 'its width: 300', shadowed: false }],
      },
      {
        label: 'inputs of pic',
        vars: [
          { name: 'l', detail: 'list = [1,2]', shadowed: false },
          { name: 'd', detail: 'number = 3', shadowed: true },
          { name: 'tone', detail: 'string, inherited', shadowed: false },
        ],
      },
    ])
  })

  it("doesn't count a node's own each or expose, and gives orphans only the inputs", () => {
    expect(scopeAt(spec, 'pic', 'n1')!.map((f) => f.label)).toEqual([
      'exposed by svg n0',
      'inputs of pic',
    ])
    expect(scopeAt(spec, 'pic', 'lost')!.map((f) => f.label)).toEqual([
      'inputs of pic',
    ])
    expect(scopeAt(spec, 'pic', 'missing')).toBeUndefined()
  })
})

describe('project operations', () => {
  it('tracks unsaved files and clears them when saved', () => {
    let project = newProject('projects', 'mine')
    expect(project.unsaved).toEqual(['components/mine'])
    project = setSample(
      updateComponent(project, 'mine', (s) => setParam(s, 'n0', 'width', 10)),
      'mine',
      { v: 1 },
    )
    expect(project.unsaved).toEqual(['components/mine', 'samples/mine'])
    expect(updateComponent(project, 'mine', (s) => s)).toBe(project) // no change, nothing marked
    expect(markSaved(project, ['components/mine']).unsaved).toEqual([
      'samples/mine',
    ])
  })

  it('duplicates a read-only project as a writable one with every file unsaved', () => {
    const example = {
      ...addComponent(newProject('examples', 'ex'), 'b'),
      readOnly: true,
      unsaved: [],
    }
    const copy = duplicateProject(
      { ...example, samples: { ex: {} } },
      'projects',
      'mine',
    )
    expect(copy).toMatchObject({
      root: 'projects',
      name: 'mine',
      readOnly: false,
    })
    expect(copy.unsaved).toEqual([
      'components/b',
      'components/ex',
      'samples/ex',
    ])
  })

  it('fills in declared inputs the sample lacks, using defaults or empty values', () => {
    const inputs = {
      l: { type: 'list' as const },
      cy: { type: 'number' as const, default: 25 },
      name: { type: 'string' as const },
      x: {},
    }
    expect(withMissingInputs({ name: 'kept' }, inputs)).toEqual({
      name: 'kept',
      l: [],
      cy: 25,
      x: null,
    })
    expect(
      withMissingInputs({ l: [], cy: 1, name: '', x: 0 }, inputs),
    ).toBeUndefined()
  })

  it('starts new components as a blank picture that compiles cleanly', () => {
    const program = compile('c', { c: blankComponent() })
    expect(program.errors).toEqual([])
    expect(toSvgString(program.render().output)).toBe(
      '<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg" />\n',
    )
  })
})
