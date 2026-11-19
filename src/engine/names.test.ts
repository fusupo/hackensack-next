import { expect, it } from 'vitest'
import {
  compile,
  eachNames,
  exposedNames,
  exprNames,
  gridNames,
  NODE_TYPES,
  paramNames,
  SPEC_FORMAT,
  toSvgString,
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

it('each, grid and exposed names follow the rules compile uses', () => {
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

  // expose: only on element nodes, valid names, params the node sets.
  const group: NodeSpec = {
    type: 'g',
    params: { opacity: 0.5 },
    expose: { op: 'opacity', 'bad name': 'opacity', unset: 'transform' },
    children: ['n2'],
  }
  expect(exposedNames(group)).toEqual([{ name: 'op', param: 'opacity' }])
  const exposed = draw(
    single({
      n0: { type: 'svg', children: ['n1'] },
      n1: group,
      n2: { type: 'text', params: { text: '=string(op)' } },
    }),
  )
  expect(exposed.svg).toContain('>0.5</text>')
  expect(
    exposedNames({
      type: 'each',
      params: { list: 'l' },
      expose: { l: 'list' },
    }),
  ).toEqual([])
})

it('exposedNames leaves out animation nodes and keeps shapes', () => {
  // On main animate is an unknown node type, so the check below would pass
  // for the wrong reason.
  expect(NODE_TYPES.animate?.tag).toBe('animate')
  expect(
    exposedNames({
      type: 'animate',
      params: { attributeName: 'r', to: '2', dur: 2 },
      expose: { speed: 'dur' },
    }),
  ).toEqual([])
  expect(
    exposedNames({
      type: 'animateTransform',
      params: { to: '2', dur: 2 },
      expose: { target: 'to' },
    }),
  ).toEqual([])
  expect(
    exposedNames({ type: 'circle', params: { r: 5 }, expose: { r: 'r' } }),
  ).toEqual([{ name: 'r', param: 'r' }])
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
