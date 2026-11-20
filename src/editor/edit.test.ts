import { describe, expect, it } from 'vitest'
import { compile, SPEC_FORMAT, toSvgString } from '@hackensack/engine'
import type { ComponentSpec } from '@hackensack/engine'
import {
  addNode,
  addVar,
  connect,
  connectProblem,
  defaultVarName,
  deleteNodes,
  disconnect,
  freezeLayout,
  moveNodes,
  moveVar,
  nextNodeId,
  parseParamInput,
  removeVar,
  renameVar,
  renameInput,
  setInput,
  setParam,
  setRef,
  setRoot,
  setVarExpression,
  varNameError,
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
import { scopeAt, scopeFrames } from './scope.ts'

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
    // A shape takes animation nodes only (#15).
    expect(connectProblem(base(), 'n9', 'n2')).toBe(
      'a rect node only takes animation nodes (animate, animateTransform), not a g',
    )
    expect(connectProblem(base(), 'n0', 'n9')).toBe(
      "the root can't go inside another node",
    )
    expect(connectProblem(base(), 'n1', 'n1')).toBe(
      "a node can't go inside itself",
    )
    expect(connectProblem(base(), 'n1', 'n3')).toBe(
      'a circle node only takes animation nodes (animate, animateTransform), not a g',
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
      n0: { type: 'svg', params: { width: 300 }, children: ['v'] },
      v: { type: 'vars', vars: { w: '300' }, children: ['n1'] },
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
        label: 'vars v',
        vars: [{ name: 'w', detail: '300', shadowed: false }],
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

  it("doesn't count a node's own each or vars, and gives orphans only the inputs", () => {
    expect(scopeAt(spec, 'pic', 'v')!.map((f) => f.label)).toEqual([
      'inputs of pic',
    ])
    expect(scopeAt(spec, 'pic', 'n1')!.map((f) => f.label)).toEqual([
      'vars v',
      'inputs of pic',
    ])
    expect(scopeAt(spec, 'pic', 'lost')!.map((f) => f.label)).toEqual([
      'inputs of pic',
    ])
    expect(scopeAt(spec, 'pic', 'missing')).toBeUndefined()
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

it("the scope panel has no exposed frame for a stray expose key and lists a vars node's names for a shape's animation child", () => {
  const spec: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'cccccccc',
    root: 'n0',
    nodes: {
      n0: { type: 'svg', params: { width: 300 }, children: ['v'] },
      v: { type: 'vars', vars: { sunR: '12' }, children: ['c'] },
      // A v3 leftover: expose was removed in v4 and binds nothing.
      c: {
        type: 'circle',
        params: { r: 'sunR' },
        expose: { radius: 'r' },
        children: ['a'],
      } as never,
      a: {
        type: 'animate',
        params: { attributeName: 'r', values: '{sunR}; {sunR * 2}' },
      },
    },
  }
  const frames = scopeFrames(spec, 'pic', 'a')!
  expect(frames.some((f) => (f.kind as string) === 'expose')).toBe(false)
  expect(frames.some((f) => f.label.startsWith('exposed by'))).toBe(false)
  expect(frames.map((f) => [f.kind, f.label])).toEqual([
    ['vars', 'vars v'],
    ['inputs', 'inputs of pic'],
  ])
  expect(frames[0]!.vars).toEqual([
    { name: 'sunR', detail: '12', shadowed: false },
  ])
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

it('the scope panel lists vars names as a frame of their own', () => {
  const spec: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'dddd0050',
    inputs: { size: { type: 'number', default: 4 } },
    root: 'n0',
    nodes: {
      n0: {
        type: 'vars',
        // Refused entries (a constant, a self read) aren't listed.
        vars: { size: '7', label: "'outer'", pi: '3', self: 'self + 1' },
        children: ['n1'],
      },
      n1: {
        type: 'vars',
        vars: { label: "concat('inner ', 'label')" },
        children: ['n2'],
      },
      n2: { type: 'text', params: { text: '=label' } },
    },
  }
  expect(scopeAt(spec, 'pic', 'n2')).toEqual([
    {
      label: 'vars n1',
      vars: [
        {
          name: 'label',
          detail: "concat('inner ', 'label')",
          shadowed: false,
        },
      ],
    },
    {
      label: 'vars n0',
      vars: [
        { name: 'size', detail: '7', shadowed: false },
        // The nearer vars node's label shadows this one.
        { name: 'label', detail: "'outer'", shadowed: true },
      ],
    },
    {
      label: 'inputs of pic',
      // A vars name shadows the input of the same name.
      vars: [{ name: 'size', detail: 'number = 4', shadowed: true }],
    },
  ])
  // A vars node's own names apply to its children, not to it.
  expect(scopeAt(spec, 'pic', 'n0')!.map((f) => f.label)).toEqual([
    'inputs of pic',
  ])
  expect(scopeAt(spec, 'pic', 'n1')!.map((f) => f.label)).toEqual([
    'vars n0',
    'inputs of pic',
  ])
})

it('connect refuses a vars node under a shape and accepts one under a g', () => {
  const spec: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'eeee0050',
    root: 'n0',
    nodes: {
      n0: { type: 'svg', children: [] },
      g: { type: 'g' },
      c: { type: 'circle', params: { r: 2 } },
      v: { type: 'vars', vars: { a: '1' } },
    },
  }
  expect(connectProblem(spec, 'v', 'c')).toBe(
    'a circle node only takes animation nodes (animate, animateTransform), not a vars',
  )
  expect(connect(spec, 'v', 'c', 0)).toBe(spec)
  expect(connectProblem(spec, 'v', 'g')).toBeUndefined()
  expect(connect(spec, 'v', 'g', 0).nodes.g!.children).toEqual(['v'])
})

it('connect puts a shape or anything else under a vars node', () => {
  const spec: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'eeee0051',
    root: 'n0',
    nodes: {
      n0: { type: 'svg', children: [] },
      c: { type: 'circle', params: { r: 2 } },
      e: { type: 'each', params: { list: '[1]' } },
      v: { type: 'vars', vars: { a: '1' } },
    },
  }
  expect(connectProblem(spec, 'c', 'v')).toBeUndefined()
  expect(connectProblem(spec, 'e', 'v')).toBeUndefined()
  const wired = connect(connect(spec, 'c', 'v', 0), 'e', 'v', 1)
  expect(wired.nodes.v!.children).toEqual(['c', 'e'])
})

it('vars edits keep order and refuse bad names', () => {
  const spec: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'ffff0050',
    root: 'v',
    nodes: {
      v: { type: 'vars', vars: { a: '1', b: 'a + 1' } },
      g: { type: 'g' },
    },
  }
  const names = (s: ComponentSpec) => Object.keys(s.nodes.v!.vars ?? {})

  // Add: the default name at the end; only on a vars node.
  expect(defaultVarName(spec.nodes.v!)).toBe('value')
  const added = addVar(spec, 'v')
  expect(added.nodes.v!.vars).toEqual({ a: '1', b: 'a + 1', value: '0' })
  expect(defaultVarName(added.nodes.v!)).toBe('value2')
  expect(addVar(spec, 'g')).toBe(spec)

  // The name check: invalid, taken, a constant; unchanged and function
  // names are fine.
  const node = spec.nodes.v!
  expect(varNameError(node, 'a', '')).toBe('Give the value a name.')
  expect(varNameError(node, 'a', '2x')).toBe(
    'A name starts with a letter or _ and has only letters, digits and _.',
  )
  expect(varNameError(node, 'a', 'b')).toBe(
    '"b" is already a name in this node.',
  )
  expect(varNameError(node, 'a', 'pi')).toBe(
    '"pi" is a math.js constant; choose another name.',
  )
  expect(varNameError(node, 'a', 'a')).toBeUndefined()
  expect(varNameError(node, 'a', 'max')).toBeUndefined()
  expect(addVar(spec, 'v', '1', 'pi')).toBe(spec)

  // Rename keeps the position and doesn't rewrite b's expression.
  const renamed = renameVar(added, 'v', 'a', 'first')
  expect(renamed.nodes.v!.vars).toEqual({
    first: '1',
    b: 'a + 1',
    value: '0',
  })
  expect(names(renamed)).toEqual(['first', 'b', 'value'])
  for (const refused of ['', '2x', 'b', 'e'])
    expect(renameVar(added, 'v', 'a', refused)).toBe(added)

  // Edit an expression in place.
  const edited = setVarExpression(renamed, 'v', 'b', 'first * 2')
  expect(edited.nodes.v!.vars).toEqual({
    first: '1',
    b: 'first * 2',
    value: '0',
  })
  expect(setVarExpression(edited, 'v', 'b', 'first * 2')).toBe(edited)

  // Move up and down; not past either end.
  expect(names(moveVar(edited, 'v', 'value', -1))).toEqual([
    'first',
    'value',
    'b',
  ])
  expect(names(moveVar(edited, 'v', 'first', 1))).toEqual([
    'b',
    'first',
    'value',
  ])
  expect(moveVar(edited, 'v', 'first', -1)).toBe(edited)
  expect(moveVar(edited, 'v', 'value', 1)).toBe(edited)

  // Remove; the vars key goes with the last one.
  const removed = removeVar(edited, 'v', 'b')
  expect(names(removed)).toEqual(['first', 'value'])
  const emptied = removeVar(removeVar(removed, 'v', 'first'), 'v', 'value')
  expect(emptied.nodes.v).toEqual({ type: 'vars' })
})
