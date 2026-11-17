import { describe, expect, it } from 'vitest'
import { SPEC_FORMAT } from '../engine/index.ts'
import type { ComponentSpec, SvgElement } from '../engine/index.ts'
import { describeLocation, problemsByNode } from './diagnostics.ts'
import { nodeHeight, specToFlow } from './layout.ts'
import { fitPreview } from './preview.ts'
import { groupProjectFiles, sampleFor } from './projects.ts'

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
    expect(at('root').data).toMatchObject({ slots: 2, isRoot: true })
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
