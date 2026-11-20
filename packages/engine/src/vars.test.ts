// The `vars` node (#50): named values for a subtree. It draws nothing; its
// names are defined in order, each evaluated every time the node is drawn.
// On main `vars` is an unknown node type, so every test below that expects
// no problems, or a problem on a name, fails there.

import { expect, it } from 'vitest'
import { MATH_CONSTANTS, compileExpr } from './expr.ts'
import {
  bundle,
  compile,
  readBundle,
  SPEC_FORMAT,
  toSvgString,
  withDefaults,
} from './index.ts'
import type { ComponentSpec, Diagnostic, InputDecl, NodeSpec } from './index.ts'
import { Frame } from './scope.ts'

/** A component whose root is the first node listed. */
function spec(
  nodes: Record<string, NodeSpec>,
  inputs: Record<string, InputDecl> = {},
): ComponentSpec {
  return {
    format: SPEC_FORMAT,
    id: 'card0001',
    inputs,
    root: Object.keys(nodes)[0]!,
    nodes,
  }
}

/** toSvgString's output on one line, for short comparisons. */
const flat = (svg: string) => svg.replace(/\n\s*/g, '')

/** Compile + render one component; the SVG (on one line) and every problem. */
function run(s: ComponentSpec, data: Record<string, unknown> = {}) {
  const program = compile('card', { card: s })
  const result = program.render(data)
  return {
    svg: flat(toSvgString(result.output)),
    errors: [...program.errors, ...result.errors],
  }
}

/** The problems as `node param: message`, for readable comparisons. */
const problems = (errors: Diagnostic[]) =>
  errors.map((e) => `${e.node ?? ''} ${e.param ?? ''}: ${e.message}`)

const rect = (width: string): NodeSpec => ({
  type: 'rect',
  params: { width, height: 1 },
})

it('a vars node draws nothing and its children go straight into its parent', () => {
  const children = {
    r: rect('3'),
    c: { type: 'circle', params: { r: 2 } },
  }
  const direct = run(
    spec({ s: { type: 'svg', children: ['r', 'c'] }, ...children }),
  )
  expect(direct.errors).toEqual([])
  expect(direct.svg).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="3" height="1" /><circle r="2" /></svg>',
  )

  // With names, with an empty vars field and with none at all: the same
  // output, with no element and no <g> of its own.
  for (const vars of [{ a: '1' }, {}, undefined] as (
    Record<string, string> | undefined
  )[]) {
    const result = run(
      spec({
        s: { type: 'svg', children: ['v'] },
        v: { type: 'vars', ...(vars && { vars }), children: ['r', 'c'] },
        ...children,
      }),
    )
    expect(result.errors).toEqual([])
    expect(result.svg).toBe(direct.svg)
  }

  // As the root, its children are the component's output, in child order.
  const root = run(
    spec({ v: { type: 'vars', vars: {}, children: ['c', 'r'] }, ...children }),
  )
  expect(root.errors).toEqual([])
  expect(root.svg).toBe('<circle r="2" /><rect width="3" height="1" />')
})

it('a vars name reads the names before it and a self or later read is reported', () => {
  // In order: c reads b, which reads a.
  const ordered = run(
    spec({
      v: {
        type: 'vars',
        vars: { a: '2', b: 'a * 3', c: 'b + a' },
        children: ['r'],
      },
      r: rect('c'),
    }),
  )
  expect(ordered.errors).toEqual([])
  expect(ordered.svg).toBe('<rect width="8" height="1" />')

  // A self read is reported, and x stays the input's 5 below the node.
  const self = run(
    spec(
      {
        v: { type: 'vars', vars: { x: 'x * 2' }, children: ['r'] },
        r: rect('x'),
      },
      { x: { type: 'number', default: 5 } },
    ),
  )
  expect(problems(self.errors)).toEqual([
    'v x: "x" reads itself; a name can only read the names before it',
  ])
  expect(self.svg).toBe('<rect width="5" height="1" />')

  // A read of a later name is reported and leaves p unbound; q is bound.
  const later = run(
    spec({
      v: { type: 'vars', vars: { p: 'q + 1', q: '2' }, children: ['r', 'r2'] },
      r: rect('q'),
      r2: rect('p'),
    }),
  )
  expect(problems(later.errors)).toEqual([
    'v p: "p" reads "q", defined after it; a name can only read the names before it',
    'r2 width: Undefined symbol p',
  ])
  expect(later.svg).toBe('<rect width="2" height="1" /><rect height="1" />')
})

it('a vars node inside an each is evaluated once per item', () => {
  const result = run(
    spec(
      {
        s: { type: 'svg', children: ['each'] },
        each: { type: 'each', params: { list: 'l' }, children: ['v'] },
        v: { type: 'vars', vars: { w: 'd * 2 + i' }, children: ['r'] },
        r: rect('w'),
      },
      { l: { type: 'list', default: [10, 20, 30] } },
    ),
  )
  expect(result.errors).toEqual([])
  expect(result.svg).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="1" /><rect width="41" height="1" /><rect width="62" height="1" /></svg>',
  )
})

it('a vars name can hold a number, a list, a string or a colour, and a list drives an each and a colour a fill', () => {
  const result = run(
    spec({
      s: { type: 'svg', children: ['v'] },
      v: {
        type: 'vars',
        vars: {
          size: '4',
          sizes: '[1, 2, 3]',
          label: "concat('wind ', 'gust')",
          shade: "mix('#000000', '#ffffff', 0.5)",
        },
        children: ['r', 'each', 't'],
      },
      r: {
        type: 'rect',
        params: { width: 'size', height: 'size', fill: '=shade' },
      },
      each: { type: 'each', params: { list: 'sizes' }, children: ['c'] },
      c: { type: 'circle', params: { r: 'd', fill: '=shade' } },
      t: { type: 'text', params: { text: '=label' } },
    }),
  )
  expect(result.errors).toEqual([])
  expect(result.svg).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4" fill="#808080" />' +
      '<circle r="1" fill="#808080" /><circle r="2" fill="#808080" /><circle r="3" fill="#808080" />' +
      '<text>wind gust</text></svg>',
  )
})

it('vars names are checked, constants are refused and a name shadows an input', () => {
  const result = run(
    spec(
      {
        v: {
          type: 'vars',
          vars: {
            '2bad': '1',
            pi: '2',
            e: '3',
            Infinity: '4',
            count: '5',
            max: '6',
            mix: '7',
            x: '8',
          },
          children: ['r', 'r2'],
        },
        r: {
          type: 'rect',
          params: { width: 'count + max + mix', height: 'x' },
        },
        // The refused names keep their math.js meaning below the node.
        r2: { type: 'rect', params: { width: 'pi', height: 'e' } },
      },
      { x: { type: 'number', default: 1 } },
    ),
  )
  expect(problems(result.errors)).toEqual([
    `v 2bad: "2bad" isn't a valid variable name`,
    'v pi: "pi" is a math.js constant; choose another name',
    'v e: "e" is a math.js constant; choose another name',
    'v Infinity: "Infinity" is a math.js constant; choose another name',
  ])
  // Function names are fine as names, and x shadows the input's 1.
  expect(result.svg).toBe(
    '<rect width="18" height="8" /><rect width="3.141593" height="2.718282" />',
  )
})

it('a failing vars expression is reported on the node and the rest draws', () => {
  // Fails when evaluated: reported on the name, which is left unbound.
  const failing = run(
    spec({
      s: { type: 'svg', children: ['v'] },
      v: {
        type: 'vars',
        vars: { bad: 'nowhere + 1', ok: '2' },
        children: ['r', 'r2'],
      },
      r: rect('ok'),
      r2: rect('bad'),
    }),
  )
  expect(problems(failing.errors)).toEqual([
    'v bad: Undefined symbol nowhere',
    'r2 width: Undefined symbol bad',
  ])
  expect(failing.svg).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="1" /><rect height="1" /></svg>',
  )

  // Doesn't compile, isn't text, set on a g, params on a vars node: each
  // reported, and the rest still draws.
  const result = run(
    spec({
      s: { type: 'svg', children: ['v', 'g'] },
      v: {
        type: 'vars',
        params: { list: 'l' },
        vars: { broken: '1 +', num: 3 as unknown as string, fine: '4' },
        children: ['r'],
      },
      r: rect('fine'),
      g: { type: 'g', vars: { a: '1' }, children: ['r2'] },
      r2: rect('2'),
    }),
  )
  const found = problems(result.errors)
  expect(found).toHaveLength(4)
  expect(found).toContain(
    'v list: a vars node takes no params ("list"); its names go in its vars',
  )
  expect(found.some((p) => p.startsWith('v broken: '))).toBe(true)
  expect(found).toContain(
    'v num: the value of "num" should be an expression, written as text; got number 3',
  )
  expect(found).toContain('g : vars has no effect on g nodes')
  expect(result.svg).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="1" /><g><rect width="2" height="1" /></g></svg>',
  )

  // A vars field that isn't an object of names.
  const shapeless = run(
    spec({
      v: {
        type: 'vars',
        vars: 'a' as unknown as Record<string, string>,
        children: ['r'],
      },
      r: rect('1'),
    }),
  )
  expect(problems(shapeless.errors)).toEqual([
    'v : vars should map names to expressions, got string "a"',
  ])
})

it('a vars node cannot sit under a shape but works above one', () => {
  const under = run(
    spec({
      c: { type: 'circle', params: { r: 2 }, children: ['v'] },
      v: { type: 'vars', vars: { a: '1' }, children: [] },
    }),
  )
  expect(problems(under.errors)).toEqual([
    'v : a circle node only takes animation nodes (animate, animateTransform), not a vars',
  ])
  expect(under.svg).toBe('<circle r="2" />')

  // Above the shape, its names reach the shape's params and its animation.
  const above = run(
    spec({
      v: { type: 'vars', vars: { rad: '7', big: 'rad * 2' }, children: ['c'] },
      c: { type: 'circle', params: { r: 'rad' }, children: ['a'] },
      a: {
        type: 'animate',
        params: { attributeName: 'r', to: '{big}', dur: 'rad / 7' },
      },
    }),
  )
  expect(above.errors).toEqual([])
  expect(above.svg).toBe(
    '<circle r="7"><animate attributeName="r" to="14" dur="1s" /></circle>',
  )
})

it('expose still accepts a constant name such as pi', () => {
  const result = run(
    spec({
      g: {
        type: 'g',
        params: { 'stroke-width': 3 },
        expose: { pi: 'stroke-width' },
        children: ['c'],
      },
      c: { type: 'circle', params: { r: 'pi' } },
    }),
  )
  expect(result.errors).toEqual([])
  expect(result.svg).toBe('<g stroke-width="3"><circle r="3" /></g>')
})

it('every name in MATH_CONSTANTS is a constant math.js resolves', () => {
  const empty = new Frame(new Map(), undefined, {
    kind: 'inputs',
    component: 'test',
  })
  for (const name of MATH_CONSTANTS)
    expect(() => compileExpr(name)(empty), name).not.toThrow()
  // Function names aren't constants.
  expect(MATH_CONSTANTS).not.toContain('max')
})

it('a bundle holding a vars node draws the same in the player as in the editor', () => {
  const card = spec(
    {
      v: { type: 'vars', vars: { half: 'w / 2' }, children: ['r'] },
      r: rect('half'),
    },
    { w: { type: 'number', default: 10 } },
  )
  const read = readBundle(
    JSON.parse(JSON.stringify(bundle('card', { card }, { w: 30 }))),
  )
  expect(read.problems).toBeUndefined()
  const b = read.bundle!
  const program = compile(b.root, b.components)
  const result = program.render(withDefaults(b, {}))
  expect([...program.errors, ...result.errors]).toEqual([])
  expect(flat(toSvgString(result.output))).toBe(run(card, { w: 30 }).svg)
  expect(flat(toSvgString(result.output))).toBe(
    '<rect width="15" height="1" />',
  )
})
