import { describe, expect, it } from 'vitest'
import { compile, SPEC_FORMAT, toSvgString } from '../engine/index.ts'
import type { ComponentSpec, Diagnostic, SvgElement } from '../engine/index.ts'
import { setParam } from './edit.ts'
import { describeLocation, problemsAt, problemsByNode } from './diagnostics.ts'
import { nodeHeight, specToFlow } from './layout.ts'
import { fitPreview } from './preview.ts'
import {
  fromFiles,
  groupProjectFiles,
  sampleFor,
  updateComponent,
} from './projects.ts'
import {
  currentOf,
  enterComponent,
  exitTo,
  openTrail,
  pruneTrail,
  topOf,
} from './trail.ts'
import type { Trail } from './trail.ts'

const spec = (
  nodes: ComponentSpec['nodes'],
  extra: Partial<ComponentSpec> = {},
): ComponentSpec => ({
  format: SPEC_FORMAT,
  root: Object.keys(nodes)[0]!,
  nodes,
  ...extra,
})

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
  const library: Record<string, ComponentSpec> = {
    card: spec({
      n0: { type: 'svg', children: ['i1', 'i2'] },
      i1: instance('sun'),
      i2: instance('sun'),
      bad: instance('moon'),
    }),
    sun: spec({ s0: { type: 'g', children: ['r1'] }, r1: instance('ray') }),
    ray: spec({ l: { type: 'line' }, back: instance('sun') }),
  }

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
    const repointed = {
      ...library,
      card: spec({
        n0: { type: 'svg', children: ['i1'] },
        i1: instance('ray'),
      }),
    }
    expect(pruneTrail(trail, repointed)).toEqual(trail.slice(0, 1))
  })

  it('editing the entered definition changes every instance in the outer picture', () => {
    const project = fromFiles({
      root: 'projects',
      name: 'sun-card',
      readOnly: false,
      components: {
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
      },
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
