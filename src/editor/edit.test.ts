import { describe, expect, it } from 'vitest'
import { compile, SPEC_FORMAT, toSvgString } from '../engine/index.ts'
import type { ComponentSpec } from '../engine/index.ts'
import {
  addExpose,
  addNode,
  connect,
  connectProblem,
  defaultExposeName,
  deleteNodes,
  disconnect,
  exposableParams,
  exposeNameError,
  freezeLayout,
  moveNodes,
  nextNodeId,
  parseParamInput,
  removeExpose,
  renameExpose,
  renameInput,
  repointExpose,
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
  id: 'aaaaaaaa',
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
    id: 'bbbbbbbb',
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

  it('scope panel lists exposed variables only on svg-element nodes and only valid entries', () => {
    const withLeaf = (leaf: ComponentSpec['nodes'][string]): ComponentSpec => ({
      format: SPEC_FORMAT,
      id: 'cccccccc',
      root: 'n0',
      nodes: {
        n0: {
          type: 'svg',
          params: { width: 300, height: 100 },
          // Only `w` is bound: `2bad` isn't a valid name, and n0 doesn't
          // set `x`.
          expose: { w: 'width', '2bad': 'height', gone: 'x' },
          children: ['n1'],
        },
        n1: {
          type: 'each',
          params: { list: '[1]' },
          expose: { listed: 'list' },
          children: ['n2'],
        },
        n2: {
          type: 'grid',
          params: { count: 1 },
          expose: { counted: 'count' },
          children: ['n3'],
        },
        n3: leaf,
      },
    })
    const frames = scopeAt(withLeaf({ type: 'rect' }), 'pic', 'n3')!
    expect(frames.map((f) => f.label)).toEqual([
      'grid n2',
      'each n1',
      'exposed by svg n0',
      'inputs of pic',
    ])
    expect(frames[2]!.vars).toEqual([
      { name: 'w', detail: 'its width: 300', shadowed: false },
    ])

    // The engine agrees: only the listed name is bound.
    const problems = (name: string) => {
      const spec = withLeaf({ type: 'rect', params: { width: name } })
      const program = compile('pic', { pic: spec })
      return [...program.errors, ...program.render({}).errors]
        .filter((e) => e.node === 'n3')
        .map((e) => e.message)
    }
    expect(problems('w')).toEqual([])
    for (const name of ['listed', 'counted', 'gone'])
      expect(problems(name)).toEqual([`Undefined symbol ${name}`])
  })
})

describe('scope panel for a grid', () => {
  const gridSpec = (names: Record<string, string> = {}): ComponentSpec => ({
    format: SPEC_FORMAT,
    id: 'aaaaaaaa',
    inputs: { rain: { type: 'number' } },
    root: 'n0',
    nodes: {
      n0: { type: 'each', params: { list: '[1]' }, children: ['n1'] },
      n1: {
        type: 'grid',
        params: { count: 'rain / 5', ...names },
        children: ['n2'],
      },
      n2: { type: 'g', children: ['n3'] },
      n3: { type: 'rect', params: { x: 'col', y: 'row', width: 'n' } },
    },
  })

  it("lists a grid's column, row and index for its children", () => {
    const spec = gridSpec({ col: 'x', row: 'y', index: 'k' })
    const frames = scopeAt(spec, 'pic', 'n3', { rain: 10 })!
    expect(frames.map((f) => f.label)).toEqual([
      'grid n1',
      'each n0',
      'inputs of pic',
    ])
    expect(frames[0]).toEqual({
      label: 'grid n1',
      vars: [
        { name: 'x', detail: 'its column, from 0', shadowed: false },
        { name: 'y', detail: 'its row, from 0', shadowed: false },
        {
          name: 'k',
          detail: 'its position, counting row by row from 0',
          shadowed: false,
        },
      ],
    })
    // The grid's default index name `n` doesn't hide the each's `i`.
    const defaults = scopeAt(gridSpec(), 'pic', 'n3')!
    expect(defaults[0]!.vars.map((v) => v.name)).toEqual(['col', 'row', 'n'])
    expect(defaults[1]!.vars).toContainEqual({
      name: 'i',
      detail: "that item's position, from 0",
      shadowed: false,
    })
    // The grid's own params don't see its variables.
    expect(scopeAt(spec, 'pic', 'n1')!.map((f) => f.label)).toEqual([
      'each n0',
      'inputs of pic',
    ])
  })

  it('uses the default grid names in the scope panel when the engine would', () => {
    const cases: Record<string, string>[] = [
      { col: '1x', row: 'y' }, // an invalid name
      { col: 'a', row: 'a' }, // two the same
      { index: 'col' }, // a custom name equal to another default
    ]
    for (const names of cases) {
      const spec = gridSpec(names)
      const frames = scopeAt(spec, 'pic', 'n3')!
      expect(
        frames[0]!.vars.map((v) => v.name),
        JSON.stringify(names),
      ).toEqual(['col', 'row', 'n'])
      // The engine agrees: the child reads col, row and n with no problem
      // beyond the one about the names.
      const program = compile('pic', { pic: spec })
      const { output, errors } = program.render({ rain: 10 })
      expect(program.errors, JSON.stringify(names)).toHaveLength(1)
      expect(errors).toEqual([])
      expect(toSvgString(output)).toContain('<rect x="1" y="0" width="1" />')
    }
  })
})

describe('exposing params', () => {
  const exposing = (node: ComponentSpec['nodes'][string]): ComponentSpec => ({
    format: SPEC_FORMAT,
    id: 'dddddddd',
    root: 'n0',
    nodes: { n0: node },
  })
  const n0 = (spec: ComponentSpec) => spec.nodes.n0!

  it('offers only params the node sets and has not exposed yet', () => {
    const rect = {
      type: 'rect',
      params: { 'stroke-width': 2, width: 10, x: '0' },
      expose: { w: 'width' },
    }
    // Set and not yet exposed, in the node type's order: y, height and the
    // rest aren't set; width is already exposed.
    expect(exposableParams(rect)).toEqual(['x', 'stroke-width'])
    expect(exposableParams({ type: 'rect' })).toEqual([])
    // Nodes that draw no element can't expose anything.
    expect(
      exposableParams({ type: 'grid', params: { count: 3, columns: 2 } }),
    ).toEqual([])
    expect(exposableParams({ type: 'each', params: { list: 'l' } })).toEqual([])
    expect(exposableParams({ type: 'nope', params: { x: 1 } })).toEqual([])
  })

  it('adds an exposed variable named after the param, made valid and unique', () => {
    let spec = exposing({
      type: 'rect',
      params: { width: 10, 'stroke-width': 2, height: 5 },
    })
    spec = addExpose(spec, 'n0', 'width')
    expect(n0(spec).expose).toEqual({ width: 'width' })
    // stroke-width isn't a valid name; strokeWidth is.
    spec = addExpose(spec, 'n0', 'stroke-width')
    expect(n0(spec).expose).toEqual({
      width: 'width',
      strokeWidth: 'stroke-width',
    })
    // A param already exposed, one the node doesn't set, and an unknown node
    // leave the spec as it is.
    expect(addExpose(spec, 'n0', 'width')).toBe(spec)
    expect(addExpose(spec, 'n0', 'x')).toBe(spec)
    expect(addExpose(spec, 'nope', 'height')).toBe(spec)

    // A number is added only when the name is taken.
    const taken = { type: 'rect', expose: { height: 'width', height2: 'x' } }
    expect(defaultExposeName(taken, 'height')).toBe('height3')
    expect(defaultExposeName(taken, 'width')).toBe('width')
    expect(defaultExposeName({ type: 'rect' }, 'stroke-linecap')).toBe(
      'strokeLinecap',
    )
    expect(defaultExposeName({ type: 'rect' }, '3d')).toBe('_3d')
  })

  it('renames an exposed variable in place and refuses invalid or taken names', () => {
    const spec = exposing({
      type: 'rect',
      params: { width: 10, height: 5 },
      expose: { w: 'width', h: 'height' },
    })
    const renamed = renameExpose(spec, 'n0', 'w', 'cardW')
    expect(Object.entries(n0(renamed).expose!)).toEqual([
      ['cardW', 'width'],
      ['h', 'height'],
    ])
    for (const bad of ['', '2w', 'card-w', 'h'])
      expect(renameExpose(spec, 'n0', 'w', bad)).toBe(spec)
    expect(renameExpose(spec, 'n0', 'missing', 'x')).toBe(spec)
    expect(renameExpose(spec, 'n0', 'w', 'w')).toBe(spec)

    const node = n0(spec)
    expect(exposeNameError(node, 'w', 'cardW')).toBeUndefined()
    expect(exposeNameError(node, 'w', 'w')).toBeUndefined()
    expect(exposeNameError(node, 'w', 'h')).toBe(
      '"h" is already exposed by this node.',
    )
    expect(exposeNameError(node, 'w', '2w')).toMatch(/starts with a letter/)
    expect(exposeNameError(node, 'w', '')).toBe('Give the variable a name.')
  })

  it('repoints and removes exposed variables, dropping an empty expose', () => {
    let spec = exposing({
      type: 'rect',
      params: { width: 10, height: 5 },
      expose: { w: 'width', h: 'height' },
    })
    spec = repointExpose(spec, 'n0', 'w', 'height')
    expect(Object.entries(n0(spec).expose!)).toEqual([
      ['w', 'height'],
      ['h', 'height'],
    ])
    expect(repointExpose(spec, 'n0', 'missing', 'width')).toBe(spec)
    expect(repointExpose(spec, 'n0', 'w', 'height')).toBe(spec)

    spec = removeExpose(spec, 'n0', 'w')
    expect(n0(spec).expose).toEqual({ h: 'height' })
    expect(removeExpose(spec, 'n0', 'w')).toBe(spec)
    spec = removeExpose(spec, 'n0', 'h')
    expect('expose' in n0(spec)).toBe(false)
    expect(n0(spec).params).toEqual({ width: 10, height: 5 })
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
    const program = compile('c', { c: blankComponent('aaaaaaaa') })
    expect(program.errors).toEqual([])
    expect(toSvgString(program.render().output)).toBe(
      '<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg" />\n',
    )
  })
})
