import { expect, it } from 'vitest'
import * as engine from './index.ts'
import {
  compile,
  eachNames,
  exprNames,
  gridNames,
  NODE_TYPES,
  paramNames,
  SPEC_FORMAT,
  toSvgString,
  varsNames,
} from './index.ts'
import type { ComponentSpec, NodeSpec, ParamKind } from './index.ts'

it('exprNames lists the symbols an expression reads and nothing else', () => {
  expect(exprNames('d * 2 + w')).toEqual(['d', 'w'])
  // Each name once, first seen first.
  expect(exprNames('w + d * w')).toEqual(['w', 'd'])
  // Function names and constants are symbols too (callers filter by scope).
  expect(exprNames('remap(t, 0, 1, lo, pi)')).toEqual([
    'remap',
    't',
    'lo',
    'pi',
  ])
  // Property names and object keys are not symbols; the object is.
  expect(exprNames('item.size + {k: 1}.k')).toEqual(['item'])
  // Strings and numbers read nothing.
  expect(exprNames('"label" + 3')).toEqual([])
  expect(exprNames('[a, [b, 2]]')).toEqual(['a', 'b'])
  // Not an expression: nothing.
  expect(exprNames('2 +')).toEqual([])
  expect(exprNames('')).toEqual([])
})

it("paramNames reads expressions according to each param's kind", () => {
  // number, length, transform: strings are expressions, `=` or not.
  expect(
    paramNames({
      type: 'rect',
      params: {
        x: 'left + 1',
        y: '=top',
        width: 'w * 2 %',
        height: '=h px',
        rx: 4,
        opacity: '=alpha',
        'stroke-width': 'sw',
        transform: 'translate(dx, dy * 2) rotate(angle)',
      },
    }),
  ).toEqual(['left', 'top', 'w', 'h', 'alpha', 'sw', 'dx', 'dy', 'angle'])
  // A transform given with `=` is still read as a transform.
  expect(
    paramNames({ type: 'g', params: { transform: '=scale(k) rotate(a)' } }),
  ).toEqual(['k', 'a'])
  // color and string: literal unless `=`.
  expect(
    paramNames({
      type: 'text',
      params: { text: 'hello world', fill: '=tint', 'font-family': 'serif' },
    }),
  ).toEqual(['tint'])
  // path: holes, or the whole text after `=`.
  expect(
    paramNames({ type: 'path', params: { d: 'M 0 0 L {w} {h / 2} Z' } }),
  ).toEqual(['w', 'h'])
  expect(paramNames({ type: 'path', params: { d: '=shape' } })).toEqual([
    'shape',
  ])
  // points: a literal point string's holes, else one expression.
  expect(
    paramNames({ type: 'polygon', params: { points: '0,0 {w},0 5,{h}' } }),
  ).toEqual(['w', 'h'])
  expect(paramNames({ type: 'polyline', params: { points: 'pts' } })).toEqual([
    'pts',
  ])
  expect(
    paramNames({ type: 'polyline', params: { points: '=[[0, 0], [x1, 1]]' } }),
  ).toEqual(['x1'])
  // each: list is an expression, its names are names.
  expect(
    paramNames({
      type: 'each',
      params: { list: 'items', as: 'item', index: 'k' },
    }),
  ).toEqual(['items'])
  // grid: count and spacing are numbers, its names are names.
  expect(
    paramNames({
      type: 'grid',
      params: { count: 'rain / 5', spacing: 'gap', col: 'c' },
    }),
  ).toEqual(['rain', 'gap'])
  // Unknown params and params that don't compile read nothing, even when
  // part of them would parse.
  expect(
    paramNames({ type: 'circle', params: { bogus: 'zz', r: 'r +', cx: 'x' } }),
  ).toEqual(['x'])
  expect(
    paramNames({ type: 'g', params: { transform: 'translate(dx, =dy)' } }),
  ).toEqual([])
  expect(paramNames({ type: 'path', params: { d: 'M {w} {h +}' } })).toEqual([])
  expect(paramNames({ type: 'nosuch', params: { r: 'r' } })).toEqual([])
})

it("paramNames reads an instance's bindings by the type of the input they bind", () => {
  const instance: NodeSpec = {
    type: 'component',
    ref: 'x',
    params: {
      size: '=s * 2',
      count: 'n + 1',
      label: 'title',
      tint: '=color',
      data: 'rows',
      extra: 'zz',
    },
  }
  expect(
    paramNames(instance, {
      size: { type: 'number' },
      count: { type: 'number' },
      label: { type: 'string' },
      tint: { type: 'string' },
      data: { type: 'list' },
    }),
  ).toEqual(['s', 'n', 'color', 'rows'])
  // An unknown definition compiles no bindings.
  expect(paramNames(instance)).toEqual([])
})

/** A one-component library whose root is the first node listed. */
function single(nodes: Record<string, NodeSpec>): ComponentSpec {
  return {
    format: SPEC_FORMAT,
    id: 'abcd0001',
    inputs: {},
    root: Object.keys(nodes)[0]!,
    nodes,
  }
}

/** Render `card` and return its SVG text and render errors. */
function draw(card: ComponentSpec) {
  const { output, errors } = compile('card', { card }).render({})
  return { svg: toSvgString(output), errors }
}

it('each and grid names follow the rules compile uses', () => {
  // each: an invalid name falls back to its own default, on its own.
  const each: NodeSpec = {
    type: 'each',
    params: { list: '[7]', as: 'bad name', index: 'k' },
    children: ['n2'],
  }
  const [as, index] = eachNames(each)
  expect([as, index]).toEqual(['d', 'k'])
  const shown = draw(
    single({
      n0: { type: 'svg', children: ['n1'] },
      n1: each,
      n2: {
        type: 'text',
        params: { text: `=string(${as} * 10 + ${index})` },
      },
    }),
  )
  expect(shown.errors).toEqual([])
  expect(shown.svg).toContain('>70</text>')
  expect(eachNames({ type: 'each', params: { list: '[]' } })).toEqual([
    'd',
    'i',
  ])

  // grid: two equal names (or an invalid one) mean all three defaults.
  const broken: Record<string, string>[] = [
    { col: 'a', row: 'a' },
    { col: 'a', index: '9' },
  ]
  for (const params of broken) {
    const grid: NodeSpec = {
      type: 'grid',
      params: { count: 1, ...params },
      children: ['n2'],
    }
    const names = gridNames(grid)
    expect(names).toEqual(['col', 'row', 'n'])
    const cell = draw(
      single({
        n0: { type: 'svg', children: ['n1'] },
        n1: grid,
        n2: {
          type: 'text',
          params: { text: `=string(${names.join(' + ')})` },
        },
      }),
    )
    expect(cell.errors).toEqual([])
    expect(cell.svg).toContain('>0</text>')
  }
  expect(
    gridNames({ type: 'grid', params: { col: 'x', row: 'y', index: 'k' } }),
  ).toEqual(['x', 'y', 'k'])
})

it('vars names and reads follow the rules compile uses', () => {
  // Kept, in order: a, b and count (a function name is fine). Refused: an
  // invalid name, a constant, a value that isn't text, one that doesn't
  // compile, a self read and a read of a later name.
  const vars: NodeSpec = {
    type: 'vars',
    vars: {
      a: 'outer + 1',
      'bad name': '1',
      pi: '2',
      howMany: 3 as unknown as string,
      broken: '1 +',
      self: 'self + 1',
      early: 'b * 2',
      b: 'a * 10 + other',
      count: 'b + a',
    },
    children: ['n2'],
  }
  expect(varsNames(vars)).toEqual(['a', 'b', 'count'])
  // Reads from outside the node: outer and other, not a or b (read from the
  // node itself), and nothing from the refused entries.
  expect(paramNames(vars)).toEqual(['outer', 'other'])

  // Rendering agrees: the kept names are bound, the refused ones aren't.
  const card: ComponentSpec = {
    ...single({
      n0: { type: 'svg', children: ['n1'] },
      n1: vars,
      n2: {
        type: 'text',
        params: { text: '=string(a * 10000 + b * 100 + count)' },
      },
    }),
    inputs: {
      outer: { type: 'number', default: 1 },
      other: { type: 'number', default: 5 },
    },
  }
  const shown = draw(card)
  expect(shown.errors).toEqual([])
  expect(shown.svg).toContain('>22527</text>')
  const program = compile('card', { card })
  expect(program.errors.map((e) => e.param)).toEqual([
    'bad name',
    'pi',
    'howMany',
    'broken',
    'self',
    'early',
  ])
  for (const refused of ['self', 'early', 'howMany']) {
    const missing = draw({
      ...card,
      nodes: {
        ...card.nodes,
        n2: { type: 'text', params: { text: `=string(${refused})` } },
      },
    })
    expect(missing.errors.map((e) => e.message)).toEqual([
      `Undefined symbol ${refused}`,
    ])
  }

  // Only a vars node binds or reads its vars.
  expect(varsNames({ type: 'g', vars: { a: '1' } })).toEqual([])
  expect(paramNames({ type: 'g', vars: { a: 'zz' } })).toEqual([])
  expect(varsNames({ type: 'vars' })).toEqual([])
})

it('the engine no longer exports exposes or exposedNames', () => {
  // expose was removed in spec format v4 (#51): nothing decides what it
  // binds any more, because it binds nothing.
  expect(Object.keys(engine)).not.toContain('exposes')
  expect(Object.keys(engine)).not.toContain('exposedNames')
  // The rules that replaced it are still there.
  expect(typeof engine.varsNames).toBe('function')
  expect(typeof engine.readVars).toBe('function')
})

it('paramNames reads every param kind of every node type in the registry', () => {
  // A value of each kind that reads exactly the symbol `zz`. Typed by
  // ParamKind, so a new kind without a row here fails to type-check.
  const reading: Record<ParamKind, string | undefined> = {
    number: 'zz',
    length: 'zz',
    expr: 'zz',
    time: 'zz',
    color: '=zz',
    string: '=zz',
    attribute: '=zz',
    transform: 'rotate(zz)',
    path: 'M {zz} 0',
    template: '0 {zz}',
    points: '=zz',
    name: undefined, // a binding name, not read; compile handles it per node
  }
  // Every kind but `name` is used by some param in the registry.
  const used = new Set(
    Object.values(NODE_TYPES).flatMap((def) =>
      Object.values(def.params).map((p) => p.kind),
    ),
  )
  for (const kind of Object.keys(reading) as ParamKind[]) {
    if (kind !== 'name') expect([kind, used.has(kind)]).toEqual([kind, true])
  }
  // Params a node needs before it evaluates the others.
  const baseline: Record<string, Record<string, string | number>> = {
    grid: { count: 1 },
  }
  for (const [type, def] of Object.entries(NODE_TYPES)) {
    for (const [param, paramDef] of Object.entries(def.params)) {
      const value = reading[paramDef.kind]
      if (value === undefined) continue
      const node: NodeSpec = {
        type,
        params: { ...baseline[type], [param]: value },
      }
      // paramNames says the param reads zz...
      expect([type, param, paramNames(node).includes('zz')]).toEqual([
        type,
        param,
        true,
      ])
      // ...and the engine does read it: zz is undeclared, so rendering
      // reports it on that param.
      const program = compile('c', {
        c: { format: SPEC_FORMAT, id: 'c', root: 'n', nodes: { n: node } },
      })
      const problems = [...program.errors, ...program.render({}).errors]
      expect([
        type,
        param,
        problems.some(
          (p) =>
            p.node === 'n' &&
            p.param === param &&
            /Undefined symbol zz/.test(p.message),
        ),
      ]).toEqual([type, param, true])
    }
  }
})
