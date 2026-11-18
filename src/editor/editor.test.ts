import { describe, expect, it } from 'vitest'
import {
  compile,
  SPEC_FORMAT,
  SPEC_FORMAT_V2,
  toSvgString,
} from '../engine/index.ts'
import type {
  ComponentSpec,
  Diagnostic,
  SvgElement,
  SvgNode,
} from '../engine/index.ts'
import { commitProject, CommitError } from './commit.ts'
import type { Send } from './commit.ts'
import { deleteNodes, setParam, setRef } from './edit.ts'
import { describeLocation, problemsAt, problemsByNode } from './diagnostics.ts'
import { enteredChain, markEntered } from './highlight.ts'
import { nodeHeight, specToFlow } from './layout.ts'
import { fitPreview } from './preview.ts'
import { idsIn, newId } from './ids.ts'
import type { RandomBytes } from './ids.ts'
import {
  addComponent,
  blankComponent,
  deleteComponent,
  duplicateComponent,
  fromFiles,
  groupProjectFiles,
  markRemoved,
  markSaved,
  newProject,
  pendingCount,
  renameComponent,
  renameProject,
  sampleFor,
  setSample,
  updateComponent,
} from './projects.ts'
import type { Outcome, Project, ProjectFiles } from './projects.ts'
import {
  currentOf,
  enterComponent,
  exitTo,
  openTrail,
  pruneTrail,
  renameInTrail,
  settleTrail,
  topOf,
} from './trail.ts'
import type { Trail } from './trail.ts'
import { upgradeLibrary } from './upgrade.ts'
import {
  definitionName,
  instancesText,
  namesById,
  usageOf,
  usageCount,
  usesByComponent,
} from './usage.ts'

const spec = (
  nodes: ComponentSpec['nodes'],
  extra: Partial<ComponentSpec> = {},
): ComponentSpec => ({
  format: SPEC_FORMAT,
  id: '',
  root: Object.keys(nodes)[0]!,
  nodes,
  ...extra,
})

/**
 * Give every spec without an id its name as id, so refs in these tests can
 * read like names. (Real ids are random; refs only ever match ids.)
 */
const named = (
  library: Record<string, ComponentSpec>,
): Record<string, ComponentSpec> =>
  Object.fromEntries(
    Object.entries(library).map(([name, s]) => [
      name,
      s.id ? s : { ...s, id: name },
    ]),
  )

describe('projects', () => {
  const projects = groupProjectFiles(
    {
      '/examples/b/components/z.json': spec({ n: { type: 'g' } }),
      '/examples/b/components/a.json': spec(
        { n: { type: 'g' } },
        { inputs: { size: { default: 3 }, name: {} } },
      ),
      '/examples/a/components/x.json': spec({ n: { type: 'g' } }),
      '/somewhere/else.json': {},
    },
    { '/examples/b/samples/z.data.json': { v: 1 } },
  )

  it('groups files by project, sorted by name', () => {
    expect(projects.map((p) => p.name)).toEqual(['a', 'b'])
    expect(Object.keys(projects[1]!.library)).toEqual(['a', 'z'])
    expect(projects[1]!.samples).toEqual({ z: { v: 1 } })
  })

  it('starts from the sample file, else from the inputs’ defaults', () => {
    const b = projects[1]!
    expect(sampleFor(b, 'z')).toEqual({ v: 1 })
    expect(sampleFor(b, 'a')).toEqual({ size: 3 })
  })
})

describe('graph layout', () => {
  const tree = spec({
    root: { type: 'svg', children: ['g', 'c'] },
    g: { type: 'g', children: ['r1', 'r2'] },
    r1: { type: 'rect', params: { x: 1, fill: '#fff' } },
    r2: { type: 'rect' },
    c: { type: 'component', ref: 'sun', params: { radius: 'd * 2' } },
    lost: { type: 'circle' },
  })
  const { nodes, edges } = specToFlow(tree, new Map([['r2', ['x: oops']]]))
  const at = (id: string) => nodes.find((n) => n.id === id)!

  it('puts the root on the right and children further left, one column per level', () => {
    expect(at('root').position.x).toBe(0)
    expect(at('g').position.x).toBeLessThan(0)
    expect(at('r1').position.x).toBeLessThan(at('g').position.x)
  })

  it('stacks children top to bottom in child order', () => {
    expect(at('r1').position.y).toBeLessThan(at('r2').position.y)
    expect(at('g').position.y).toBeLessThan(at('c').position.y)
  })

  it('wires each child’s output to its parent’s numbered slot', () => {
    expect(edges).toContainEqual({
      id: 'root:1',
      source: 'c',
      sourceHandle: 'out',
      target: 'root',
      targetHandle: 'slot-1',
    })
    expect(edges).toHaveLength(4)
  })

  it('describes each node for its card', () => {
    expect(at('root').data).toMatchObject({ slots: 3, isRoot: true }) // 2 children + 1 empty
    expect(at('r1').data).toMatchObject({
      slots: 0,
      isRoot: false,
      params: [
        { name: 'x', value: '1' },
        { name: 'fill', value: '#fff' },
      ],
    })
    expect(at('c').data).toMatchObject({
      ref: 'sun',
      params: [{ name: 'radius', value: 'd * 2' }],
    })
    expect(at('r2').data.problems).toEqual(['x: oops'])
  })

  it('still shows nodes that are not connected to the root, without overlapping', () => {
    const lost = at('lost')
    const others = nodes.filter(
      (n) => n.id !== 'lost' && n.position.x === lost.position.x,
    )
    for (const other of others) {
      const separate =
        lost.position.y >= other.position.y + nodeHeight(other.data) ||
        other.position.y >= lost.position.y + nodeHeight(lost.data)
      expect(separate).toBe(true)
    }
  })

  it('puts the use count on instance nodes with a known definition only', () => {
    const library = named({
      tree,
      sun: spec({ body: { type: 'circle' } }),
      other: spec({
        o0: { type: 'g', children: ['o1', 'o2'] },
        o1: { type: 'component', ref: 'sun' },
        o2: { type: 'component', ref: 'moon' },
      }),
    })
    const counted = specToFlow(
      library.other!,
      new Map(),
      usageOf(library),
      namesById(library),
    )
    const data = (id: string) => counted.nodes.find((n) => n.id === id)!.data
    expect(data('o1').uses).toBe(2) // c in tree, o1 here
    expect(data('o2')).not.toHaveProperty('uses') // moon is missing
    expect(data('o0')).not.toHaveProperty('uses')
    expect(at('c').data).not.toHaveProperty('uses') // no usage given
  })

  it('uses saved editor positions when the spec has them', () => {
    const saved = specToFlow({ ...tree, editor: { g: { x: 5, y: 6 } } })
    expect(saved.nodes.find((n) => n.id === 'g')!.position).toEqual({
      x: 5,
      y: 6,
    })
  })
})

describe('preview fitting', () => {
  it('gives a fixed-size svg a viewBox and makes it fill the pane', () => {
    const [svg] = fitPreview([
      { tag: 'svg', attrs: { width: '400', height: '300' }, children: [] },
    ]) as SvgElement[]
    expect(svg!.attrs).toEqual({
      width: '100%',
      height: '100%',
      viewBox: '0 0 400 300',
    })
  })

  it('leaves percentage-sized svgs without a viewBox alone', () => {
    const output = [{ tag: 'svg', attrs: { width: '100%' }, children: [] }]
    expect(fitPreview(output)).toEqual(output)
  })

  it('wraps output that has no svg root, e.g. a component on its own', () => {
    const [svg] = fitPreview([
      { tag: 'g', attrs: {}, children: [] },
    ]) as SvgElement[]
    expect(svg!.tag).toBe('svg')
    expect(svg!.children).toEqual([{ tag: 'g', attrs: {}, children: [] }])
  })
})

describe('diagnostics', () => {
  const problems = [
    { component: 'scene', node: 'a', param: 'x', message: 'bad x', path: [] },
    { component: 'scene', node: 'a', message: 'bad node', path: [] },
    {
      component: 'sun',
      node: 'c',
      param: 'fill',
      message: 'inside',
      path: ['a'],
    },
    { component: 'scene', param: 'size', message: 'missing input' },
  ]

  it('says where a problem is, including the instance path', () => {
    expect(problems.map(describeLocation)).toEqual([
      'scene · a.x',
      'scene · a',
      'sun via a · c.fill',
      'scene · size',
    ])
  })

  it('groups a component’s own node problems for its graph', () => {
    expect([...problemsByNode(problems, 'scene')]).toEqual([
      ['a', ['x: bad x', 'bad node']],
    ])
  })
})

describe('diagnostics inside an entered component', () => {
  // card › sun (entered through instance i2) › ray (through r1)
  const problems: Diagnostic[] = [
    { component: 'card', node: 'n0', message: 'card render', path: [] },
    {
      component: 'sun',
      node: 'c',
      param: 'r',
      message: 'via i1',
      path: ['i1'],
    },
    {
      component: 'sun',
      node: 'c',
      param: 'r',
      message: 'via i2',
      path: ['i2'],
    },
    { component: 'ray', node: 'l', message: 'ray via i2', path: ['i2', 'r1'] },
    { component: 'sun', node: 'c', message: 'compile problem' },
  ]
  const sunTrail: Trail = [
    { component: 'card' },
    { component: 'sun', via: 'i2' },
  ]

  it('problemsAt gives the same problems as before at the top of the trail', () => {
    const top = problemsAt(problems, openTrail('card'))
    expect(top).toEqual(problems)
    expect([...problemsByNode(top, 'card')]).toEqual([
      ...problemsByNode(problems, 'card'),
    ])
  })

  it('problemsAt keeps render problems from the entered instance, with paths made relative to it', () => {
    const inSun = problemsAt(problems, sunTrail)
    expect(inSun).toContainEqual({
      component: 'sun',
      node: 'c',
      param: 'r',
      message: 'via i2',
      path: [],
    })
    expect(inSun).toContainEqual({
      component: 'ray',
      node: 'l',
      message: 'ray via i2',
      path: ['r1'],
    })
    expect([...problemsByNode(inSun, 'sun')]).toEqual([
      ['c', ['r: via i2', 'compile problem']],
    ])
  })

  it('problemsAt leaves out render problems from other instances', () => {
    const messages = problemsAt(problems, sunTrail).map((d) => d.message)
    expect(messages).not.toContain('via i1')
    expect(messages).not.toContain('card render')
    expect(messages).toContain('compile problem')
  })
})

describe('trail', () => {
  const instance = (ref: string) => ({ type: 'component', ref })
  const library: Record<string, ComponentSpec> = named({
    card: spec({
      n0: { type: 'svg', children: ['i1', 'i2'] },
      i1: instance('sun'),
      i2: instance('sun'),
      bad: instance('moon'),
    }),
    sun: spec({ s0: { type: 'g', children: ['r1'] }, r1: instance('ray') }),
    ray: spec({ l: { type: 'line' }, back: instance('sun') }),
  })

  it('openTrail starts a fresh trail with one component', () => {
    const trail = openTrail('sun')
    expect(trail).toEqual([{ component: 'sun' }])
    expect(currentOf(trail)).toBe('sun')
    expect(topOf(trail)).toBe('sun')
  })

  it('enters a component and appends it to the trail', () => {
    const entered = enterComponent(openTrail('card'), library, 'i2')
    expect(entered).toEqual({
      trail: [{ component: 'card' }, { component: 'sun', via: 'i2' }],
    })
    if (!('trail' in entered)) throw new Error('not entered')
    expect(currentOf(entered.trail)).toBe('sun')
    expect(topOf(entered.trail)).toBe('card')
  })

  it('refuses a missing ref or one already in the trail', () => {
    const start = openTrail('card')
    expect(enterComponent(start, library, 'bad')).toEqual({
      error: expect.stringContaining('moon') as unknown,
    })
    expect(enterComponent(start, library, 'n0')).toHaveProperty('error')
    expect(enterComponent(start, library, 'nope')).toHaveProperty('error')
    const deep: Trail = [
      { component: 'card' },
      { component: 'sun', via: 'i1' },
      { component: 'ray', via: 'r1' },
    ]
    expect(enterComponent(deep, library, 'back')).toEqual({
      error: expect.stringContaining('sun') as unknown,
    })
  })

  it('exitTo truncates the trail to the chosen crumb', () => {
    const trail: Trail = [
      { component: 'card' },
      { component: 'sun', via: 'i1' },
    ]
    expect(exitTo(trail, 0)).toEqual([{ component: 'card' }])
    expect(exitTo(trail, 1)).toEqual(trail)
  })

  it('enters through several levels and exits to any of them', () => {
    let trail: Trail = openTrail('card')
    for (const id of ['i1', 'r1']) {
      const entered = enterComponent(trail, library, id)
      if (!('trail' in entered)) throw new Error(entered.error)
      trail = entered.trail
    }
    expect(trail.map((c) => c.component)).toEqual(['card', 'sun', 'ray'])
    expect(currentOf(trail)).toBe('ray')
    expect(topOf(trail)).toBe('card')
    expect(exitTo(trail, 1).map((c) => c.component)).toEqual(['card', 'sun'])
    expect(exitTo(trail, 0).map((c) => c.component)).toEqual(['card'])
  })

  it('pruneTrail cuts the trail at the first missing component', () => {
    const trail: Trail = [
      { component: 'card' },
      { component: 'sun', via: 'i1' },
      { component: 'ray', via: 'r1' },
    ]
    expect(pruneTrail(trail, library)).toEqual(trail)
    const { ray: _ray, ...withoutRay } = library
    expect(pruneTrail(trail, withoutRay)).toEqual(trail.slice(0, 2))
    const repointed = named({
      ...library,
      card: spec({
        n0: { type: 'svg', children: ['i1'] },
        i1: instance('ray'),
      }),
    })
    expect(pruneTrail(trail, repointed)).toEqual(trail.slice(0, 1))
  })

  it('editing the entered definition changes every instance in the outer picture', () => {
    const project = fromFiles({
      root: 'projects',
      name: 'sun-card',
      readOnly: false,
      components: named({
        'sun-card': spec({
          n0: { type: 'svg', children: ['a', 'b', 'c'] },
          a: { type: 'component', ref: 'sun', params: { radius: 10 } },
          b: { type: 'component', ref: 'sun', params: { radius: 20 } },
          c: { type: 'component', ref: 'sun', params: { radius: 40 } },
        }),
        sun: spec(
          {
            body: { type: 'circle', params: { r: 'radius', fill: '#f5b942' } },
          },
          { inputs: { radius: { type: 'number', default: 20 } } },
        ),
      }),
      samples: {},
      problems: [],
    })
    const entered = enterComponent(openTrail('sun-card'), project.library, 'b')
    if (!('trail' in entered)) throw new Error(entered.error)
    const { trail } = entered

    const edited = updateComponent(project, currentOf(trail), (s) =>
      setParam(s, 'body', 'fill', '#ff0000'),
    )
    const { output, errors } = compile(topOf(trail), edited.library).render({})
    expect(errors).toEqual([])
    const svg = toSvgString(output)
    expect(svg.match(/fill="#ff0000"/g)).toHaveLength(3)
    expect(svg).not.toContain('#f5b942')
    expect(edited.unsaved).toEqual(['components/sun'])
  })
})

// The usage fixture: scene uses card once; card uses sun twice and cloud
// once; cloud uses sun. Shared by describe('usage') and the empty-ref test
// after it.
const usageInstance = (ref: string) => ({ type: 'component', ref })
const usageLibrary: Record<string, ComponentSpec> = named({
  scene: spec({
    s0: { type: 'svg', children: ['c1'] },
    c1: usageInstance('card'),
  }),
  card: spec({
    n0: { type: 'svg', children: ['i1', 'i2', 'k1'] },
    i1: usageInstance('sun'),
    i2: usageInstance('sun'),
    k1: usageInstance('cloud'),
    empty: usageInstance(''),
    broken: usageInstance('moon'),
    noRef: { type: 'component' },
  }),
  cloud: spec({ g: { type: 'g', children: ['s'] }, s: usageInstance('sun') }),
  sun: spec({ body: { type: 'circle' } }),
  lonely: spec({ body: { type: 'rect' } }),
})

describe('usage', () => {
  const library = usageLibrary
  const usage = usageOf(library)

  it('counts every instance node of a definition across components', () => {
    expect(usageCount(usage, 'sun')).toBe(3)
    expect(usage.get('sun')).toEqual([
      { component: 'card', node: 'i1' },
      { component: 'card', node: 'i2' },
      { component: 'cloud', node: 's' },
    ])
    expect(usageCount(usage, 'cloud')).toBe(1)
  })

  it('reports zero uses for a definition nothing uses', () => {
    expect(usageCount(usage, 'lonely')).toBe(0)
    expect(usageCount(usage, 'scene')).toBe(0)
    expect(usage.has('lonely')).toBe(false)
  })

  it('counts direct uses only, not uses inside nested definitions', () => {
    // scene › card › sun: card is used once, by scene; sun's count is
    // unchanged by scene using card.
    expect(usageCount(usage, 'card')).toBe(1)
    expect(usage.get('card')).toEqual([{ component: 'scene', node: 'c1' }])
    expect(usage.get('sun')!.map((u) => u.component)).not.toContain('scene')
  })

  it('ignores instances of missing definitions', () => {
    expect(usageCount(usage, 'moon')).toBe(0)
    expect(usage.has('moon')).toBe(false)
    expect([...usage.keys()].sort()).toEqual(['card', 'cloud', 'sun'])
  })

  it('recounts after an unsaved edit to a component', () => {
    const project = fromFiles({
      root: 'projects',
      name: 'p',
      readOnly: false,
      components: library,
      samples: {},
      problems: [],
    })
    const fewer = updateComponent(project, 'card', (s) =>
      deleteNodes(s, ['i2']),
    )
    expect(fewer.unsaved).toEqual(['components/card'])
    expect(usageCount(usageOf(fewer.library), 'sun')).toBe(2)
    const repointed = updateComponent(fewer, 'card', (s) =>
      setRef(s, 'broken', 'sun'),
    )
    expect(usageCount(usageOf(repointed.library), 'sun')).toBe(3)
    expect(usageCount(usageOf(project.library), 'sun')).toBe(3)
  })

  it('groups the uses of a definition by component with node ids', () => {
    expect(usesByComponent(usage.get('sun')!)).toEqual([
      { component: 'card', nodes: ['i1', 'i2'] },
      { component: 'cloud', nodes: ['s'] },
    ])
    expect(usesByComponent([])).toEqual([])
    expect(instancesText(1)).toBe('1 instance')
    expect(instancesText(3)).toBe('3 instances')
  })
})

// Top level so its name is exactly the contract's selector (#3, AC-14.e2).
it('usage ignores instances with an empty ref', () => {
  const usage = usageOf(usageLibrary)
  expect(usageCount(usage, '')).toBe(0)
  expect(usage.has('')).toBe(false)
  expect([...usage.values()].flat().map((u) => u.node)).not.toContain('empty')
  expect([...usage.values()].flat().map((u) => u.node)).not.toContain('noRef')
})

// --- #3: definition ids and the v2 → v3 upgrade -----------------------------

/** A predictable random source: ids come out as 00000001, 00000002, … */
function counter(start = 1): RandomBytes {
  let n = start
  return () => {
    const v = n++
    return new Uint8Array([
      v >>> 24,
      (v >>> 16) & 255,
      (v >>> 8) & 255,
      v & 255,
    ])
  }
}

const v2 = (nodes: ComponentSpec['nodes']) =>
  ({
    format: SPEC_FORMAT_V2,
    root: Object.keys(nodes)[0]!,
    nodes,
  }) as unknown as ComponentSpec

const projectFiles = (
  components: Record<string, unknown>,
  readOnly = false,
): ProjectFiles => ({
  root: readOnly ? 'examples' : 'projects',
  name: 'p',
  readOnly,
  components,
  samples: {},
  problems: [],
})

it('upgrades a v2 library: adds ids and rewrites name refs to ids', () => {
  const sun = { ...v2({ c: { type: 'circle' } }), inputs: { r: {} } }
  const { library, changed } = upgradeLibrary(
    {
      sun,
      card: v2({
        g: { type: 'g', children: ['a', 'b'] },
        a: { type: 'component', ref: 'sun', params: { r: 'r * 2' } },
        b: { type: 'component', ref: 'sun' },
      }),
    },
    counter(),
  )
  expect(changed).toEqual(['sun', 'card'])
  expect(library.sun).toEqual({
    format: SPEC_FORMAT,
    id: '00000001',
    root: 'c',
    nodes: { c: { type: 'circle' } },
    inputs: { r: {} },
  })
  expect(library.card!.id).toBe('00000002')
  expect(library.card!.format).toBe(SPEC_FORMAT)
  expect(library.card!.nodes.a).toEqual({
    type: 'component',
    ref: '00000001',
    params: { r: 'r * 2' },
  })
  expect(library.card!.nodes.b!.ref).toBe('00000001')
  expect(compile('card', library).errors).toEqual([])
})

it('leaves a v3 library untouched and refs to missing components as they are', () => {
  const v3: Record<string, ComponentSpec> = {
    sun: spec({ c: { type: 'circle' } }, { id: 'aaaaaaaa' }),
    card: spec(
      { a: { type: 'component', ref: 'aaaaaaaa' } },
      { id: 'bbbbbbbb' },
    ),
  }
  const same = upgradeLibrary(v3, counter())
  expect(same.changed).toEqual([])
  expect(same.library).toEqual(v3)
  expect(same.library.sun).toBe(v3.sun)

  const { library } = upgradeLibrary(
    { old: v2({ a: { type: 'component', ref: 'ghost' } }) },
    counter(),
  )
  expect(library.old!.nodes.a!.ref).toBe('ghost')
})

it('marks upgraded files unsaved, except in read-only projects', () => {
  const components = {
    sun: v2({ c: { type: 'circle' } }),
    card: v2({ a: { type: 'component', ref: 'sun' } }),
  }
  const writable = fromFiles(projectFiles(components), counter())
  expect(writable.unsaved).toEqual(['components/sun', 'components/card'])
  expect(writable.library.card!.nodes.a!.ref).toBe(writable.library.sun!.id)

  const readOnly = fromFiles(projectFiles(components, true), counter())
  expect(readOnly.unsaved).toEqual([])
  expect(readOnly.library.sun!.format).toBe(SPEC_FORMAT)
})

it('upgrades only the v2 file in a mixed library, pointing its ref at the existing v3 component id, and marks only that file unsaved', () => {
  const sun = spec({ c: { type: 'circle' } }, { id: 'aaaaaaaa' })
  const project = fromFiles(
    projectFiles({
      sun,
      old: v2({
        g: { type: 'g', children: ['n1'] },
        n1: { type: 'component', ref: 'sun' },
      }),
    }),
    counter(),
  )
  expect(project.unsaved).toEqual(['components/old'])
  expect(project.library.sun).toBe(sun)
  expect(project.library.old!.format).toBe(SPEC_FORMAT)
  expect(project.library.old!.id).toBe('00000001')
  expect(project.library.old!.nodes.n1!.ref).toBe('aaaaaaaa')
})

it('newId retries until the id is not taken, using the injected random source', () => {
  expect(newId([], counter())).toBe('00000001')
  expect(newId(['00000001', '00000002'], counter())).toBe('00000003')
  expect(idsIn({ a: { id: 'x' }, b: {}, c: { id: '' } })).toEqual(['x'])
})

it('the default id source gives 8 hex characters', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newId([])))
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}$/)
  expect(ids.size).toBe(50)
})

it("a new component and a new project's first component get an id", () => {
  const project = newProject('projects', 'mine', counter())
  expect(project.library.mine!.id).toBe('00000001')
  const more = addComponent(project, 'other')
  const id = more.library.other!.id
  expect(id).toMatch(/^[0-9a-f]{8}$/)
  expect(id).not.toBe('00000001')
  expect(blankComponent('cafebabe').id).toBe('cafebabe')
})

// --- #3: renaming, duplicating and deleting components and projects --------

/** A saved project: card uses sun twice next to a rect; sun has sample data. */
function sunCard(): Project {
  return fromFiles(
    projectFiles({
      card: spec(
        {
          g: { type: 'svg', children: ['a', 'b', 'box'] },
          a: { type: 'component', ref: 'id-sun', params: { r: 5 } },
          b: { type: 'component', ref: 'id-sun', params: { r: 9 } },
          box: { type: 'rect', params: { width: 4 } },
        },
        { id: 'id-card' },
      ),
      sun: spec(
        { c: { type: 'circle', params: { r: 'r' } } },
        { id: 'id-sun', inputs: { r: { type: 'number', default: 1 } } },
      ),
    }),
  )
}
const withSample = (p: Project): Project => ({
  ...p,
  samples: { sun: { r: 3 } },
})
const ok = (outcome: Outcome): Project => {
  if ('error' in outcome) throw new Error(outcome.error)
  return outcome.project
}

it('renameComponent moves the file and sample, keeps the id, and queues the old files', () => {
  const before = withSample(sunCard())
  const after = ok(renameComponent(before, 'sun', 'star'))
  expect(Object.keys(after.library)).toEqual(['card', 'star'])
  expect(after.library.star).toBe(before.library.sun)
  expect(after.library.star!.id).toBe('id-sun')
  expect(after.samples).toEqual({ star: { r: 3 } })
  expect(after.unsaved).toEqual(['components/star', 'samples/star'])
  expect(after.removed).toEqual(['components/sun', 'samples/sun'])
  expect(pendingCount(after)).toBe(4)
})

it('renameComponent leaves other components and their refs unchanged', () => {
  const before = sunCard()
  const after = ok(renameComponent(before, 'sun', 'star'))
  expect(after.library.card).toBe(before.library.card)
  expect(after.unsaved).not.toContain('components/card')
})

it('renameComponent refuses invalid and taken names', () => {
  const project = sunCard()
  expect(renameComponent(project, 'sun', 'card')).toEqual({
    error: 'There is already a component named "card".',
  })
  expect(renameComponent(project, 'sun', '../x')).toHaveProperty('error')
  expect(renameComponent(project, 'sun', 'constructor')).toHaveProperty(
    'project',
  )
  expect(renameComponent(project, 'nope', 'x')).toEqual({
    error: 'There is no component named "nope".',
  })
  expect(
    renameComponent({ ...project, readOnly: true }, 'sun', 'x'),
  ).toHaveProperty('error')
  expect(ok(renameComponent(project, 'sun', 'sun'))).toBe(project)
})

it('an instance still compiles and renders after its definition is renamed', () => {
  const after = ok(renameComponent(sunCard(), 'sun', 'star'))
  const program = compile('card', after.library)
  expect(program.errors).toEqual([])
  const svg = toSvgString(program.render().output)
  expect(svg.match(/<circle /g)).toHaveLength(2)
  expect(program.components.has('star')).toBe(true)
})

it('duplicateComponent gives the copy a new id and copies the sample', () => {
  const before = withSample(sunCard())
  const after = ok(duplicateComponent(before, 'sun', 'sun2', counter()))
  expect(after.library.sun2!.id).toBe('00000001')
  expect(after.library.sun2!.nodes).toBe(before.library.sun!.nodes)
  expect(after.samples.sun2).toEqual({ r: 3 })
  expect(after.unsaved).toEqual(['components/sun2', 'samples/sun2'])
  expect(after.removed).toEqual([])
  expect(duplicateComponent(before, 'sun', 'card')).toHaveProperty('error')
})

it('duplicateComponent leaves the original and the refs inside the copy unchanged', () => {
  const before = sunCard()
  const after = ok(duplicateComponent(before, 'card', 'card2', counter()))
  expect(after.library.card).toBe(before.library.card)
  expect(after.library.card2!.nodes.a!.ref).toBe('id-sun')
  expect(after.library.card2!.id).not.toBe(before.library.card!.id)
  expect(compile('card2', after.library).errors).toEqual([])
})

it('deleteComponent removes the spec and sample and queues both files', () => {
  const after = ok(deleteComponent(withSample(sunCard()), 'sun'))
  expect(Object.keys(after.library)).toEqual(['card'])
  expect(after.samples).toEqual({})
  expect(after.removed).toEqual(['components/sun', 'samples/sun'])
  expect(after.unsaved).toEqual([])
  expect(pendingCount(after)).toBe(2)
})

it('deleteComponent refuses to delete the last component', () => {
  const one = ok(deleteComponent(sunCard(), 'sun'))
  expect(deleteComponent(one, 'card')).toEqual({
    error: "card is the project's only component. Delete the project instead.",
  })
})

it("instances of a deleted component stay in the file, report an error on the instance node, and render nothing while the parent's other elements still render", () => {
  const before = sunCard()
  const after = ok(deleteComponent(before, 'sun'))
  expect(after.library.card).toBe(before.library.card)
  const program = compile('card', after.library)
  expect(program.errors).toEqual([
    {
      component: 'card',
      node: 'a',
      message: 'no component with id "id-sun" in the library',
    },
    {
      component: 'card',
      node: 'b',
      message: 'no component with id "id-sun" in the library',
    },
  ])
  const svg = toSvgString(program.render().output)
  expect(svg).not.toContain('<circle')
  expect(svg).toContain('<rect width="4" />')
})

it('renaming a to b and back to a does not queue a for removal and keeps a unsaved', () => {
  const there = ok(renameComponent(sunCard(), 'sun', 'b'))
  const back = ok(renameComponent(there, 'b', 'sun'))
  expect(back.unsaved).toEqual(['components/sun'])
  expect(back.removed).toEqual(['components/b'])
  expect(back.library.sun!.id).toBe('id-sun')
})

it('unsaved and removed never contain the same file', () => {
  let project = withSample(sunCard())
  const steps: ((p: Project) => Project)[] = [
    (p) => ok(renameComponent(p, 'sun', 'x')),
    (p) => ok(duplicateComponent(p, 'x', 'sun', counter())),
    (p) => ok(deleteComponent(p, 'x')),
    (p) => ok(renameComponent(p, 'sun', 'x')),
    (p) => setSample(p, 'card', { v: 1 }),
    (p) => ok(deleteComponent(p, 'x')),
  ]
  for (const step of steps) {
    project = step(project)
    for (const file of project.unsaved)
      expect(project.removed).not.toContain(file)
  }
  expect(project.removed).toEqual(
    expect.arrayContaining(['components/sun', 'components/x', 'samples/x']),
  )
})

it('markRemoved clears queued removals and onDisk is set after a save', () => {
  const fresh = newProject('projects', 'mine', counter())
  expect(fresh.onDisk).toBe(false)
  expect(sunCard().onDisk).toBe(true)
  const saved = markSaved(fresh, ['components/mine'])
  expect(saved.onDisk).toBe(true)
  expect(saved.unsaved).toEqual([])
  expect(markSaved(fresh, [])).toBe(fresh)

  const deleted = ok(deleteComponent(withSample(sunCard()), 'sun'))
  const done = markRemoved(deleted, ['components/sun'])
  expect(done.removed).toEqual(['samples/sun'])
  expect(markRemoved(done, ['samples/sun']).removed).toEqual([])
})

it('pendingCount counts unsaved files plus queued removals', () => {
  const project = sunCard()
  expect(pendingCount(project)).toBe(0)
  expect(pendingCount(ok(deleteComponent(project, 'sun')))).toBe(1)
  expect(
    pendingCount(setSample(ok(deleteComponent(project, 'sun')), 'card', {})),
  ).toBe(2)
})

it('renameProject carries unsaved files, queued removals and samples over', () => {
  const edited = setSample(
    ok(renameComponent(withSample(sunCard()), 'sun', 'star')),
    'card',
    { v: 1 },
  )
  const renamed = ok(renameProject(edited, 'q', [edited]))
  expect(renamed.name).toBe('q')
  expect(renamed.root).toBe('projects')
  expect(renamed.unsaved).toEqual(edited.unsaved)
  expect(renamed.removed).toEqual(edited.removed)
  expect(renamed.samples).toBe(edited.samples)
  expect(renamed.library).toBe(edited.library)
  expect(renamed.onDisk).toBe(true)
})

it('renameProject refuses read-only projects and invalid or taken names', () => {
  const project = sunCard()
  const other = { ...newProject('projects', 'taken'), onDisk: true }
  const example = {
    ...project,
    root: 'examples',
    name: 'taken',
    readOnly: true,
  }
  expect(renameProject(project, 'taken', [project, other])).toEqual({
    error: 'There is already a project named "taken".',
  })
  // An example with the same name lives in another root: no clash.
  expect(renameProject(project, 'taken', [project, example])).toHaveProperty(
    'project',
  )
  expect(renameProject(project, 'a/b', [project])).toHaveProperty('error')
  expect(renameProject(example, 'x', [example])).toEqual({
    error: 'taken is read-only.',
  })
})

it('renameInTrail renames matching crumbs', () => {
  const trail: Trail = [{ component: 'card' }, { component: 'sun', via: 'a' }]
  expect(renameInTrail(trail, 'sun', 'star')).toEqual([
    { component: 'card' },
    { component: 'star', via: 'a' },
  ])
  expect(renameInTrail(trail, 'card', 'deck')[0]).toEqual({ component: 'deck' })
  expect(renameInTrail(trail, 'nope', 'x')).toBe(trail)
  // The renamed trail still holds against the renamed library.
  const renamed = ok(renameComponent(sunCard(), 'sun', 'star'))
  expect(
    pruneTrail(renameInTrail(trail, 'sun', 'star'), renamed.library),
  ).toHaveLength(2)
})

it('pruneTrail cuts a trail at a deleted component', () => {
  const trail: Trail = [{ component: 'card' }, { component: 'sun', via: 'a' }]
  expect(pruneTrail(trail, sunCard().library)).toEqual(trail)
  const deleted = ok(deleteComponent(sunCard(), 'sun'))
  expect(pruneTrail(trail, deleted.library)).toEqual([{ component: 'card' }])
})

it('settleTrail falls back to the default component when the first crumb was deleted', () => {
  const deleted = ok(deleteComponent(sunCard(), 'sun'))
  expect(settleTrail(openTrail('sun'), deleted)).toEqual([
    { component: 'card' },
  ])
  // A project named after one of its components opens on that one.
  const named = { ...ok(deleteComponent(sunCard(), 'card')), name: 'sun' }
  expect(settleTrail(openTrail('card'), named)).toEqual([{ component: 'sun' }])
  // A trail that still holds is kept, entered crumbs included.
  const trail: Trail = [{ component: 'card' }, { component: 'sun', via: 'b' }]
  expect(settleTrail(trail, sunCard())).toBe(trail)
})

it('usageOf resolves id refs to definition names and ignores unknown ids', () => {
  const project = sunCard()
  const usage = usageOf(project.library)
  expect([...usage.keys()]).toEqual(['sun'])
  expect(usage.get('sun')).toEqual([
    { component: 'card', node: 'a' },
    { component: 'card', node: 'b' },
  ])
  // A bare name is not an id.
  const byName = updateComponent(project, 'card', (s) => setRef(s, 'a', 'sun'))
  expect(usageCount(usageOf(byName.library), 'sun')).toBe(1)
  expect(definitionName(project.library, 'id-sun')).toBe('sun')
  expect(definitionName(project.library, 'sun')).toBeUndefined()
  expect(definitionName(project.library, undefined)).toBeUndefined()
  // An id two definitions claim resolves to neither.
  const clash = {
    ...project.library,
    copy: { ...project.library.sun!, id: 'id-sun' },
  }
  expect(usageOf(clash).size).toBe(0)
  expect(namesById(clash).has('id-sun')).toBe(false)
})

it("enterComponent follows an id ref to the definition's name", () => {
  const project = sunCard()
  expect(enterComponent(openTrail('card'), project.library, 'b')).toEqual({
    trail: [{ component: 'card' }, { component: 'sun', via: 'b' }],
  })
  const renamed = ok(renameComponent(project, 'sun', 'star'))
  expect(enterComponent(openTrail('card'), renamed.library, 'a')).toEqual({
    trail: [{ component: 'card' }, { component: 'star', via: 'a' }],
  })
  const deleted = ok(deleteComponent(project, 'sun'))
  expect(enterComponent(openTrail('card'), deleted.library, 'a')).toEqual({
    error:
      'Can\'t open a: its definition is missing (no component has the id "id-sun").',
  })
})

it("specToFlow labels an instance with its definition's name, or marks a dangling one", () => {
  const project = ok(
    renameComponent(
      updateComponent(sunCard(), 'card', (s) => setRef(s, 'b', 'deadbeef')),
      'sun',
      'star',
    ),
  )
  const { library } = project
  const { nodes } = specToFlow(
    library.card!,
    new Map(),
    usageOf(library),
    namesById(library),
  )
  const data = (id: string) => nodes.find((n) => n.id === id)!.data
  expect(data('a')).toMatchObject({ ref: 'id-sun', refName: 'star', uses: 1 })
  expect(data('b').ref).toBe('deadbeef')
  expect(data('b')).not.toHaveProperty('refName')
  expect(data('b')).not.toHaveProperty('uses')
  expect(data('box')).not.toHaveProperty('refName')
})

/** A stub for fetch that records requests and fails the ones `fails` picks. */
function recorder(
  fails: (method: string, url: string) => boolean = () => false,
) {
  const calls: string[] = []
  const send: Send = (url, init) => {
    calls.push(`${init.method} ${url}`)
    const failed = fails(init.method, url)
    return Promise.resolve({
      ok: !failed,
      status: failed ? 500 : 200,
      json: () => Promise.resolve(failed ? { error: 'disk full' } : {}),
    })
  }
  return { calls, send }
}

it('commitProject sends every PUT before any DELETE', async () => {
  // Rename sun to star and delete card's sample: two writes, three deletions.
  const project = ok(
    renameComponent(
      withSample(setSample(ok(deleteComponent(sunCard(), 'card')), 'card', {})),
      'sun',
      'star',
    ),
  )
  const { calls, send } = recorder()
  const done = await commitProject(project, send)
  expect(calls).toEqual([
    'PUT /__hackensack/projects/projects/p/components/star',
    'PUT /__hackensack/projects/projects/p/samples/star',
    'DELETE /__hackensack/projects/projects/p/components/card',
    'DELETE /__hackensack/projects/projects/p/components/sun',
    'DELETE /__hackensack/projects/projects/p/samples/sun',
  ])
  const firstDelete = calls.findIndex((c) => c.startsWith('DELETE'))
  expect(calls.slice(firstDelete).every((c) => c.startsWith('DELETE'))).toBe(
    true,
  )
  expect(done).toEqual({
    written: ['components/star', 'samples/star'],
    deleted: ['components/card', 'components/sun', 'samples/sun'],
  })
})

it('commitProject sends no DELETE when a PUT fails and reports the files that were written', async () => {
  const project = ok(renameComponent(withSample(sunCard()), 'sun', 'star'))
  const { calls, send } = recorder(
    (method, url) => method === 'PUT' && url.endsWith('/samples/star'),
  )
  const error = await commitProject(project, send).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(CommitError)
  expect((error as CommitError).message).toBe(
    "Couldn't save samples/star: disk full",
  )
  expect((error as CommitError).done).toEqual({
    written: ['components/star'],
    deleted: [],
  })
  expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false)

  // A failed DELETE reports the writes and the deletions done before it.
  const later = recorder(
    (method, url) => method === 'DELETE' && url.endsWith('/samples/sun'),
  )
  const partial = (await commitProject(project, later.send).catch(
    (e: unknown) => e,
  )) as CommitError
  expect(partial.done).toEqual({
    written: ['components/star', 'samples/star'],
    deleted: ['components/sun'],
  })
})

// Highlighting the entered instance in the preview (#4). Top-level, so each
// test's name is exactly its title.

/** Every element in the output, depth first. */
const allElements = (nodes: readonly SvgNode[]): SvgElement[] =>
  nodes.flatMap((n) =>
    typeof n === 'string' ? [] : [n, ...allElements(n.children)],
  )

const flagged = (nodes: readonly SvgNode[], flag: string) =>
  allElements(nodes).filter((e) => e.attrs[flag] === 'true')

/** `dot` draws <g><circle r=…/></g>; a scene uses it in several ways. */
const highlightLibrary = () =>
  named({
    dot: spec(
      {
        g: { type: 'g', children: ['c'] },
        c: { type: 'circle', params: { r: 'r' } },
      },
      { inputs: { r: { type: 'number', default: 1 } } },
    ),
    pair: spec({
      g: { type: 'g', children: ['d1', 'd2'] },
      d1: { type: 'component', ref: 'dot', params: { r: '2' } },
      d2: { type: 'component', ref: 'dot', params: { r: '3' } },
    }),
    scene: spec({
      root: { type: 'g', children: ['e', 'n10', 'p', 'box'] },
      e: {
        type: 'each',
        params: { list: '[10, 20, 30]', as: 'x' },
        children: ['n1'],
      },
      n1: { type: 'component', ref: 'dot', params: { r: 'x' } },
      n10: { type: 'component', ref: 'dot', params: { r: '99' } },
      p: { type: 'component', ref: 'pair' },
      box: { type: 'rect', params: { width: '1', height: '1' } },
      lost: { type: 'component', ref: 'dot' },
    }),
  })

const trackedScene = () =>
  compile('scene', highlightLibrary()).render({}, { trackOrigins: true })
    .output

it('marks every drawing of the entered instance and dims the rest', () => {
  const trail: Trail = [
    { component: 'scene' },
    { component: 'dot', via: 'n1' },
  ]
  const { output, drawn } = markEntered(trackedScene(), enteredChain(trail))
  // n1 draws inside an each over three items: all three are entered.
  expect(drawn).toBe(3)
  const entered = flagged(output, 'data-entered')
  expect(entered.map((e) => (e.children[0] as SvgElement).attrs.r)).toEqual([
    '10',
    '20',
    '30',
  ])
  // n10 (same definition, an id starting with "n1") is dimmed, not entered.
  const dimmed = flagged(output, 'data-dimmed')
  const n10 = dimmed.find(
    (e) => (e.children[0] as SvgElement | undefined)?.attrs.r === '99',
  )
  expect(n10).toBeDefined()
  // The dimmed group's children carry no flag of their own.
  expect((n10!.children[0] as SvgElement).attrs['data-dimmed']).toBeUndefined()
  // Entered elements' children aren't flagged either.
  for (const e of entered)
    expect(Object.keys((e.children[0] as SvgElement).attrs)).toEqual(['r'])
  // The pair and the plain rect are dimmed too.
  expect(dimmed.map((e) => e.tag).sort()).toEqual(['g', 'g', 'rect'])
})

it('follows a nested chain of entered instances', () => {
  const trail: Trail = [
    { component: 'scene' },
    { component: 'pair', via: 'p' },
    { component: 'dot', via: 'd2' },
  ]
  const { output, drawn } = markEntered(trackedScene(), enteredChain(trail))
  expect(drawn).toBe(1)
  const [entered] = flagged(output, 'data-entered')
  expect(entered!.origin).toEqual(['p', 'd2'])
  expect((entered!.children[0] as SvgElement).attrs.r).toBe('3')
  // Its sibling d1 is dimmed; pair's own group holds the entered one, so it isn't.
  const dimmedCircles = flagged(output, 'data-dimmed').map(
    (e) => (e.children[0] as SvgElement | undefined)?.attrs.r,
  )
  expect(dimmedCircles).toContain('2')
  const pairGroup = allElements(output).find(
    (e) => e.origin?.length === 1 && e.origin[0] === 'p',
  )
  expect(pairGroup?.attrs['data-dimmed']).toBeUndefined()
})

it('dims nothing and reports none drawn when the entered instance draws nothing', () => {
  const before = trackedScene()
  const trail: Trail = [
    { component: 'scene' },
    { component: 'dot', via: 'lost' },
  ]
  const { output, drawn } = markEntered(before, enteredChain(trail))
  expect(drawn).toBe(0)
  expect(flagged(output, 'data-dimmed')).toEqual([])
  expect(flagged(output, 'data-entered')).toEqual([])
  expect(toSvgString(output)).toBe(toSvgString(before))
  // At the top level there is no chain: nothing changes either.
  expect(markEntered(before, enteredChain([{ component: 'scene' }]))).toEqual({
    output: before,
    drawn: 0,
  })
})

it('keeps ancestors of an entered element undimmed', () => {
  const trail: Trail = [
    { component: 'scene' },
    { component: 'pair', via: 'p' },
    { component: 'dot', via: 'd1' },
  ]
  const { output } = markEntered(trackedScene(), enteredChain(trail))
  const root = output[0] as SvgElement
  expect(root.attrs).toEqual({})
  const pairGroup = root.children.find(
    (c) => typeof c !== 'string' && c.origin?.[0] === 'p',
  ) as SvgElement
  expect(pairGroup.attrs).toEqual({})
  // The serialized markup shows the flags.
  const svg = toSvgString(output)
  expect(svg).toContain('data-entered="true"')
  expect(svg).toContain('data-dimmed="true"')
})
