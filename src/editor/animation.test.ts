// Animation nodes in the editor (#15): wiring rules, card slots, the expose
// gate, the scope panel, Collapse to component and the in-context highlight.

import { expect, it } from 'vitest'
import {
  compile,
  NODE_TYPES,
  SPEC_FORMAT,
  toSvgString,
} from '../engine/index.ts'
import type {
  ComponentSpec,
  Library,
  NodeSpec,
  SvgElement,
  SvgNode,
} from '../engine/index.ts'
import { collapseInputs, collapseProblem, planCollapse } from './collapse.ts'
import { canExpose, connectProblem, exposableParams } from './edit.ts'
import { markEntered } from './highlight.ts'
import { specToFlow } from './layout.ts'
import { hasAnimation } from './preview.ts'
import { scopeAt } from './scope.ts'

function spec(
  id: string,
  nodes: Record<string, NodeSpec>,
  inputs: ComponentSpec['inputs'] = {},
): ComponentSpec {
  return {
    format: SPEC_FORMAT,
    id,
    inputs,
    root: Object.keys(nodes)[0]!,
    nodes,
  }
}

const pulse = (values: string): NodeSpec => ({
  type: 'animate',
  params: { attributeName: 'r', values, dur: 4 },
})

/** An svg holding a circle that exposes r, with an animate reading it. */
const pulsing = () =>
  spec(
    'card0001',
    {
      s: { type: 'svg', children: ['c', 'g', 'loose'] },
      c: {
        type: 'circle',
        params: { r: 12 },
        expose: { r: 'r' },
        children: ['a'],
      },
      a: pulse('{r}; {r * 1.12}; {r}'),
      g: { type: 'g' },
      loose: { type: 'rect', params: { width: 1 } },
      t: {
        type: 'animateTransform',
        params: { type: 'rotate', to: '360', dur: 2 },
      },
      e: { type: 'each', params: { list: '[1]' } },
      gr: { type: 'grid', params: { count: 1 } },
      i: { type: 'component', ref: 'other' },
    },
    { speed: { type: 'number', default: 1 } },
  )

/** Draw `name` from `library`: the SVG and every problem. */
function draw(library: Library, name: string, data = {}) {
  const program = compile(name, library)
  const result = program.render(data)
  return {
    svg: toSvgString(result.output),
    problems: [...program.errors, ...result.errors],
  }
}

it('exposableParams and canExpose offer shapes but not animation nodes', () => {
  // On main animate is an unknown node type, which can't expose either.
  expect(NODE_TYPES.animate?.tag).toBe('animate')
  const animate = pulsing().nodes.a!
  expect(canExpose(animate)).toBe(false)
  expect(exposableParams(animate)).toEqual([])
  const transform = pulsing().nodes.t!
  expect(canExpose(transform)).toBe(false)
  expect(exposableParams(transform)).toEqual([])
  // A shape still exposes, now with a reader: its animation children.
  const circle = { type: 'circle', params: { r: 12, cx: 3 } }
  expect(canExpose(circle)).toBe(true)
  expect(exposableParams(circle)).toEqual(['cx', 'r'])
})

it('the scope panel at an animation node lists what its shape exposes', () => {
  const s = pulsing()
  // The engine draws the animate with values read from the exposed r.
  const { svg } = draw({ card: s }, 'card')
  expect(svg).toContain(
    '<animate attributeName="r" values="12; 13.44; 12" dur="4s" />',
  )
  const frames = scopeAt(s, 'card', 'a', { speed: 2 })!
  expect(frames.map((f) => f.label)).toEqual([
    'exposed by circle c',
    'inputs of card',
  ])
  expect(frames[0]!.vars.map((v) => v.name)).toEqual(['r'])
})

it('connectProblem accepts animation nodes in shapes, g and svg and refuses anything else in a shape', () => {
  const s = pulsing()
  // Into the circle (a shape), the g and the svg.
  expect(connectProblem(s, 't', 'c')).toBeUndefined()
  expect(connectProblem(s, 't', 'g')).toBeUndefined()
  expect(connectProblem(s, 't', 's')).toBeUndefined()
  expect(connectProblem(s, 'a', 'loose')).toBeUndefined()
  // Anything else into a shape, each refused with its own message.
  expect(connectProblem(s, 'loose', 'c')).toBe(
    'a circle node only takes animation nodes (animate, animateTransform), not a rect',
  )
  expect(connectProblem(s, 'e', 'c')).toBe(
    'a circle node only takes animation nodes (animate, animateTransform), not an each',
  )
  expect(connectProblem(s, 'gr', 'loose')).toBe(
    'a rect node only takes animation nodes (animate, animateTransform), not a grid',
  )
  expect(connectProblem(s, 'i', 'c')).toBe(
    'a circle node only takes animation nodes (animate, animateTransform), not a component',
  )
  expect(connectProblem(s, 'g', 'c')).toBe(
    'a circle node only takes animation nodes (animate, animateTransform), not a g',
  )
  // g and svg still take anything.
  expect(connectProblem(s, 'loose', 'g')).toBeUndefined()
})

it('connectProblem refuses anything plugged into an animation node', () => {
  // On main animate is an unknown node type, refused for that reason.
  expect(NODE_TYPES.animate?.children).toBe('none')
  const s = pulsing()
  expect(connectProblem(s, 'loose', 'a')).toBe(
    "an animate node can't have children",
  )
  expect(connectProblem(s, 't', 'a')).toBe(
    "an animate node can't have children",
  )
  expect(connectProblem(s, 'a', 't')).toBe(
    "an animateTransform node can't have children",
  )
})

it('a shape gets a child slot for animations, an animation node none', () => {
  const { nodes } = specToFlow(pulsing())
  const slots = (id: string) => nodes.find((n) => n.id === id)!.data.slots
  expect(slots('c')).toBe(2) // one animation + one empty slot
  expect(slots('loose')).toBe(1) // an empty slot for an animation
  expect(slots('a')).toBe(0)
  expect(slots('t')).toBe(0)
  expect(slots('i')).toBe(0)
  expect(slots('g')).toBe(1)
})

it('collapseProblem refuses an animation node, and collapsing a shape with animations draws the same picture', () => {
  const s = pulsing()
  expect(collapseProblem(s, 'a')).toBe(
    'An animation belongs inside a shape; collapse the shape instead.',
  )
  // Loose or not.
  expect(collapseProblem(s, 't')).toBe(
    'An animation belongs inside a shape; collapse the shape instead.',
  )
  const card = spec(
    'card0001',
    {
      s: { type: 'svg', children: ['c'] },
      c: {
        type: 'circle',
        params: { r: 'size' },
        expose: { radius: 'r' },
        children: ['a'],
      },
      a: {
        type: 'animate',
        params: {
          attributeName: 'r',
          values: '{radius}; {radius * 2}; {radius}',
          dur: '=4 / speed',
        },
      },
    },
    {
      size: { type: 'number', default: 5 },
      speed: { type: 'number', default: 2 },
    },
  )
  expect(collapseProblem(card, 'c')).toBeUndefined()
  const library: Library = { card }
  const before = draw(library, 'card', { size: 6, speed: 4 })
  expect(before.problems).toEqual([])
  expect(before.svg).toContain('values="6; 12; 6" dur="1s"')
  const plan = planCollapse(library, 'card', 'c', 'c0ffee00', {
    size: 6,
    speed: 4,
  })!
  const after = draw(
    { card: plan.parent, 'card-part': plan.definition },
    'card',
    { size: 6, speed: 4 },
  )
  expect(after.problems).toEqual([])
  expect(after.svg).toBe(before.svg)
  // The animation went with its shape into the new definition.
  expect(plan.definition.nodes.a).toEqual(card.nodes.a)
})

it('collapse inputs include a name an animation param reads from outside, one its shape exposes stays inside, and a child the engine drops adds none', () => {
  const card = spec(
    'card0001',
    {
      s: { type: 'svg', children: ['c'] },
      c: {
        type: 'circle',
        params: { r: 5 },
        expose: { radius: 'r' },
        // `bad` is a rect wired under the circle: the engine drops it.
        children: ['a', 'bad'],
      },
      a: {
        type: 'animate',
        params: {
          attributeName: 'r',
          to: '{radius * 2}',
          dur: 'period',
          begin: '=delay',
        },
      },
      bad: { type: 'rect', params: { width: 'unused' } },
    },
    {
      period: { type: 'number', default: 2 },
      delay: { type: 'number', default: 0 },
      unused: { type: 'number', default: 1 },
      radius: { type: 'number', default: 1 },
    },
  )
  const { inputs } = collapseInputs({ card }, 'card', 'c')
  // period and delay are read by the animate from outside; radius is the
  // circle's own (exposed inside the subtree, though an input shares its
  // name); unused is read only by the dropped rect.
  expect(inputs).toEqual({
    period: { type: 'number' },
    delay: { type: 'number' },
  })
})

it('markEntered flags the shape an instance drew and leaves its animation child alone', () => {
  const icon = spec('icon0001', {
    c: { type: 'circle', params: { r: 5 }, children: ['a'] },
    a: pulse('5; 6; 5'),
  })
  const card = spec('card0001', {
    g: { type: 'g', children: ['n1', 'r'] },
    n1: { type: 'component', ref: 'icon0001' },
    r: { type: 'rect', params: { width: 4 }, children: ['ra'] },
    ra: pulse('1; 2; 1'),
  })
  const { output } = compile('card', { icon, card }).render(
    {},
    { trackOrigins: true },
  )
  const g = output[0] as SvgElement
  const [circle, rect] = g.children as SvgElement[]
  // The animate is drawn inside the instance's circle, with its origin.
  expect((circle!.children[0] as SvgElement).tag).toBe('animate')
  expect((circle!.children[0] as SvgElement).origin).toEqual(['n1'])

  const marked = markEntered(output, ['n1'])
  expect(marked.drawn).toBe(1)
  const [markedCircle, markedRect] = (marked.output[0] as SvgElement)
    .children as SvgElement[]
  expect(markedCircle!.attrs['data-entered']).toBe('true')
  const flags = (node: SvgNode) =>
    typeof node === 'string'
      ? []
      : Object.keys(node.attrs).filter((a) => a.startsWith('data-'))
  // Its animation is left alone, and so is the dimmed rect's.
  expect(flags(markedCircle!.children[0]!)).toEqual([])
  expect(markedRect!.attrs['data-dimmed']).toBe('true')
  expect(flags(markedRect!.children[0]!)).toEqual([])
  expect(rect!.children).toHaveLength(1)
})

it('hasAnimation finds animation elements anywhere in the output', () => {
  const draw = (nodes: Record<string, NodeSpec>) =>
    compile('c', { c: spec('cccccccc', nodes) }).render({}).output
  expect(
    hasAnimation(
      draw({
        s: { type: 'svg', children: ['g'] },
        g: { type: 'g', children: ['c'] },
        c: { type: 'circle', params: { r: 1 }, children: ['a'] },
        a: pulse('1; 2; 1'),
      }),
    ),
  ).toBe(true)
  expect(
    hasAnimation(
      draw({
        s: { type: 'svg', children: ['t'] },
        t: { type: 'animateTransform', params: { to: '1', dur: 1 } },
      }),
    ),
  ).toBe(true)
  expect(
    hasAnimation(
      draw({
        s: { type: 'svg', children: ['c', 'x'] },
        c: { type: 'circle', params: { r: 1 } },
        x: { type: 'text', params: { text: 'animate' } },
      }),
    ),
  ).toBe(false)
  expect(hasAnimation([])).toBe(false)
})
