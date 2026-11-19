// Animation nodes (#15): `animate` and `animateTransform` as SMIL elements in
// the tree, with params read from data, and shapes that take them as children.

import { expect, it } from 'vitest'
import { compile, NODE_TYPES, SPEC_FORMAT, toSvgString } from './index.ts'
import type {
  ComponentSpec,
  Diagnostic,
  InputDecl,
  Library,
  NodeSpec,
} from './index.ts'

/** A one-component library whose root is the first node listed. */
function spec(
  nodes: Record<string, NodeSpec>,
  inputs: Record<string, InputDecl> = {},
): ComponentSpec {
  return {
    format: SPEC_FORMAT,
    id: 'c',
    inputs,
    root: Object.keys(nodes)[0]!,
    nodes,
  }
}

/**
 * Compile + render; the SVG and every diagnostic (compile and render). Each
 * data name is declared as an input, so it is in scope.
 */
function run(
  s: ComponentSpec,
  data: Record<string, unknown> = {},
  others: Library = {},
) {
  const inputs: Record<string, InputDecl> = { ...s.inputs }
  for (const name of Object.keys(data)) inputs[name] ??= { type: 'any' }
  const program = compile('c', { ...others, c: { ...s, inputs } })
  const result = program.render(data)
  return {
    svg: toSvgString(result.output),
    errors: [...program.errors, ...result.errors],
  }
}

/** One animation node inside a group, next to a rect that is always drawn. */
const inGroup = (node: NodeSpec) =>
  spec({
    g: { type: 'g', children: ['a', 'r'] },
    a: node,
    r: { type: 'rect', params: { width: 4, height: 4 } },
  })

const animate = (params: NodeSpec['params']): NodeSpec => ({
  type: 'animate',
  params,
})

/** The attribute `name` of the first `<tag>` in the SVG, as written. */
const attr = (svg: string, tag: string, name: string) =>
  new RegExp(`<${tag}\\b[^>]*?\\s${name}="([^"]*)"`).exec(svg)?.[1]

const messages = (errors: Diagnostic[]) => errors.map((e) => e.message)

/** The problems reported on one node's param. */
const on = (errors: Diagnostic[], node: string, param?: string) =>
  errors.filter((e) => e.node === node && e.param === param)

/** A complete, valid set of animate params to vary one at a time. */
const valid = { attributeName: 'r', to: '20', dur: 2 }

it('animate draws an <animate> element with its params as attributes in the order listed', () => {
  expect(NODE_TYPES.animate?.tag).toBe('animate')
  const { svg, errors } = run(
    inGroup(
      animate({
        attributeName: 'opacity',
        from: '0',
        to: '1',
        dur: 2,
        repeatCount: 'indefinite',
      }),
    ),
  )
  expect(errors).toEqual([])
  expect(svg).toContain(
    '<animate attributeName="opacity" from="0" to="1" dur="2s" repeatCount="indefinite" />',
  )
  // Another order in the spec, the same order in the output.
  const reordered = run(
    inGroup(
      animate({
        repeatCount: 3,
        dur: 1,
        values: '0; 1; 0',
        calcMode: 'discrete',
        additive: 'sum',
        fill: 'freeze',
        begin: 0.5,
        keyTimes: '0; 0.5; 1',
        attributeName: 'x',
      }),
    ),
  )
  expect(reordered.errors).toEqual([])
  expect(reordered.svg).toContain(
    '<animate repeatCount="3" dur="1s" values="0; 1; 0" calcMode="discrete" additive="sum" fill="freeze" begin="0.5s" keyTimes="0; 0.5; 1" attributeName="x" />',
  )
  // The rect next to it is drawn as usual.
  expect(svg).toContain('<rect width="4" height="4" />')
})

it('animateTransform always carries attributeName transform and takes type, from, to, by and values', () => {
  expect(NODE_TYPES.animateTransform?.tag).toBe('animateTransform')
  const { svg, errors } = run(
    inGroup({
      type: 'animateTransform',
      params: {
        type: 'rotate',
        from: '0 {cx} {cy}',
        to: '360 {cx} {cy}',
        dur: 3,
        repeatCount: 'indefinite',
      },
    }),
    { cx: 10, cy: 20 },
  )
  expect(errors).toEqual([])
  expect(svg).toContain(
    '<animateTransform attributeName="transform" type="rotate" from="0 10 20" to="360 10 20" dur="3s" repeatCount="indefinite" />',
  )
  const by = run(
    inGroup({
      type: 'animateTransform',
      params: { type: 'translate', by: '0 {h}', dur: 1 },
    }),
    { h: 5 },
  )
  expect(by.errors).toEqual([])
  expect(by.svg).toContain(
    '<animateTransform attributeName="transform" type="translate" by="0 5" dur="1s" />',
  )
  const values = run(
    inGroup({
      type: 'animateTransform',
      params: { type: 'scale', values: '1; {k}; 1', dur: 2 },
    }),
    { k: 1.5 },
  )
  expect(values.errors).toEqual([])
  expect(attr(values.svg, 'animateTransform', 'values')).toBe('1; 1.5; 1')
  // attributeName is not a param of animateTransform: it is always transform.
  const named = run(
    inGroup({
      type: 'animateTransform',
      params: { attributeName: 'x', to: '1', dur: 1 },
    }),
  )
  expect(on(named.errors, 'a', 'attributeName')).toHaveLength(1)
  expect(attr(named.svg, 'animateTransform', 'attributeName')).toBe('transform')
})

it('animation nodes take no children', () => {
  expect(NODE_TYPES.animate?.children).toBe('none')
  expect(NODE_TYPES.animateTransform?.children).toBe('none')
  const { svg, errors } = run(
    spec({
      g: { type: 'g', children: ['a'] },
      a: { ...animate(valid), children: ['inner'] },
      inner: { type: 'rect', params: { width: 1 } },
    }),
  )
  expect(on(errors, 'a')).toEqual([
    expect.objectContaining({
      message: "a animate node can't have children; they are ignored",
    }),
  ])
  expect(svg).toContain('<animate attributeName="r" to="20" dur="2s" />')
  expect(svg).not.toContain('<rect')
})

it('dur and begin are seconds from expressions written with an s, and dur must be positive', () => {
  const durOf = (dur: string | number | boolean, data = {}) => {
    const { svg, errors } = run(inGroup(animate({ ...valid, dur })), data)
    return { dur: attr(svg, 'animate', 'dur'), errors: on(errors, 'a', 'dur') }
  }
  expect(durOf('=60 / wind', { wind: 20 })).toEqual({ dur: '3s', errors: [] })
  // Without `=` a string is an expression too, as for numbers.
  expect(durOf('60 / wind', { wind: 40 })).toEqual({ dur: '1.5s', errors: [] })
  expect(durOf(0.25)).toEqual({ dur: '0.25s', errors: [] })
  expect(durOf('1 / 3')).toEqual({ dur: '0.333333s', errors: [] })
  // Zero, negative and infinite durations are reported and left out.
  for (const [dur, data] of [
    [0, {}],
    [-1, {}],
    ['60 / wind', { wind: 0 }],
  ] as const) {
    const result = durOf(dur, data)
    expect(result.dur).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  }
  expect(messages(durOf(-1).errors)).toEqual([
    'dur must be more than 0, got -1',
  ])
  expect(messages(durOf('60 / wind', { wind: 0 }).errors)[0]).toMatch(
    /finite number/,
  )
  expect(durOf(true).errors).toHaveLength(1)

  // begin may be zero or negative (a negative begin starts part-way through).
  const beginOf = (begin: string | number, data = {}) =>
    attr(
      run(inGroup(animate({ ...valid, begin })), data).svg,
      'animate',
      'begin',
    )
  expect(beginOf(0)).toBe('0s')
  expect(beginOf('-n * 0.2', { n: 3 })).toBe('-0.6s')
  expect(beginOf('=delay', { delay: 1.5 })).toBe('1.5s')
})

it('from, to, by, values and keyTimes keep their text, pass JSON numbers through, fill {holes} with numbers, and report a hole that gives text', () => {
  const { svg, errors } = run(
    inGroup(
      animate({
        attributeName: 'cx',
        from: '0',
        to: 20,
        by: '{r * 2}',
        values: '{lo}; 2.5; {hi}',
        keyTimes: '0; {mid}; 1',
        dur: 4,
      }),
    ),
    { r: 3, lo: -1, hi: 1 / 3, mid: 0.25 },
  )
  expect(errors).toEqual([])
  expect(svg).toContain(
    '<animate attributeName="cx" from="0" to="20" by="6" values="-1; 2.5; 0.333333" keyTimes="0; 0.25; 1" dur="4s" />',
  )
  // Text without holes is kept exactly as written.
  expect(
    attr(
      run(inGroup(animate({ ...valid, values: 'red;  #00f ; 0' }))).svg,
      'animate',
      'values',
    ),
  ).toBe('red;  #00f ; 0')
  // A hole must give a number: text is reported on the param, which is left out.
  const text = run(inGroup(animate({ ...valid, to: '{label}' })), {
    label: 'big',
  })
  expect(on(text.errors, 'a', 'to')).toHaveLength(1)
  expect(messages(on(text.errors, 'a', 'to'))[0]).toMatch(/expected a number/)
  expect(attr(text.svg, 'animate', 'to')).toBeUndefined()
  // An unclosed hole is a compile problem on the param.
  const broken = run(inGroup(animate({ ...valid, to: '{r' })))
  expect(messages(on(broken.errors, 'a', 'to'))).toEqual([
    'unclosed "{" at position 1',
  ])
})

it('= on a values param joins a list with semicolons and an inner list with spaces, and writes text or a number as given', () => {
  const valuesOf = (values: string | boolean, data = {}) => {
    const { svg, errors } = run(
      inGroup({
        type: 'animateTransform',
        params: { type: 'translate', values, dur: 1 },
      }),
      data,
    )
    return {
      values: attr(svg, 'animateTransform', 'values'),
      errors: on(errors, 'a', 'values'),
    }
  }
  expect(valuesOf('=heights', { heights: [1, 2.5, 1 / 3] })).toEqual({
    values: '1;2.5;0.333333',
    errors: [],
  })
  expect(valuesOf('=[[0, 0], [10, dy]]', { dy: 5 })).toEqual({
    values: '0 0;10 5',
    errors: [],
  })
  // Text is written as given, and so is a number.
  expect(valuesOf('="0 0; 0 " + h', { h: '3' }).values).toBe('0 0; 0 3')
  expect(valuesOf('=k * 2', { k: 3 }).values).toBe('6')
  // A boolean, an object or a list nested too deep is reported.
  expect(valuesOf('=flag', { flag: true }).errors).toHaveLength(1)
  expect(valuesOf('=[[[1]], [2]]').errors).toHaveLength(1)
  expect(valuesOf(true).errors).toHaveLength(1)
})

it('attributeName must be a plain attribute name, never an event handler or href', () => {
  const nameOf = (attributeName: string, data = {}) => {
    const { svg, errors } = run(
      inGroup(animate({ ...valid, attributeName })),
      data,
    )
    return {
      name: attr(svg, 'animate', 'attributeName'),
      errors: on(errors, 'a', 'attributeName'),
    }
  }
  for (const ok of ['r', 'stroke-width', 'fill-opacity', 'xlink:title']) {
    expect(nameOf(ok)).toEqual({ name: ok, errors: [] })
  }
  expect(nameOf('=which', { which: 'opacity' })).toEqual({
    name: 'opacity',
    errors: [],
  })
  for (const bad of ['onclick', 'ONload', 'href', 'xlink:href', '1x', 'a b']) {
    const result = nameOf(bad)
    expect(result.name).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  }
  const computed = nameOf('=which', { which: 'onmouseover' })
  expect(computed.name).toBeUndefined()
  expect(messages(computed.errors)).toEqual([
    'attributeName must be a plain attribute name, not "onmouseover"',
  ])
})

it('type, calcMode, fill and additive take only their listed values, written or computed', () => {
  const transform = (params: NodeSpec['params'], data = {}) =>
    run(
      inGroup({
        type: 'animateTransform',
        params: { to: '1', dur: 1, ...params },
      }),
      data,
    )
  const ok = transform({
    type: 'skewX',
    calcMode: 'paced',
    fill: 'freeze',
    additive: 'sum',
  })
  expect(ok.errors).toEqual([])
  expect(ok.svg).toContain(
    'type="skewX" calcMode="paced" fill="freeze" additive="sum"',
  )
  const computed = transform({ calcMode: '=mode' }, { mode: 'discrete' })
  expect(computed.errors).toEqual([])
  expect(attr(computed.svg, 'animateTransform', 'calcMode')).toBe('discrete')

  for (const [param, value, data] of [
    ['type', 'spin', {}],
    ['calcMode', 'spline', {}],
    ['fill', 'hold', {}],
    ['additive', 'add', {}],
    ['calcMode', '=mode', { mode: 'bogus' }],
  ] as const) {
    const { svg, errors } = transform({ [param]: value }, data)
    expect(on(errors, 'a', param)).toHaveLength(1)
    expect(attr(svg, 'animateTransform', param)).toBeUndefined()
  }
  expect(messages(on(transform({ fill: 'hold' }).errors, 'a', 'fill'))).toEqual(
    ['fill must be one of freeze, remove, not "hold"'],
  )
  // SMIL's fill is called fill on animation nodes too.
  expect(NODE_TYPES.animate?.params.fill?.options).toEqual(['freeze', 'remove'])
})

it('animate and animateTransform report a missing attributeName, dur or value source', () => {
  const empty = run(inGroup(animate({})))
  expect(on(empty.errors, 'a', 'attributeName').map((e) => e.message)).toEqual([
    'animate needs an attributeName',
  ])
  expect(on(empty.errors, 'a', 'dur').map((e) => e.message)).toEqual([
    'animate needs a dur',
  ])
  expect(on(empty.errors, 'a').map((e) => e.message)).toEqual([
    'animate needs a to, by or values',
  ])
  // The element is still drawn, and so is the rest of the picture.
  expect(empty.svg).toContain('<animate />')
  expect(empty.svg).toContain('<rect')

  const transform = run(inGroup({ type: 'animateTransform', params: {} }))
  expect(messages(transform.errors).sort()).toEqual([
    'animateTransform needs a dur',
    'animateTransform needs a to, by or values',
  ])
  // from alone is no value source.
  const from = run(inGroup(animate({ attributeName: 'r', from: '1', dur: 1 })))
  expect(messages(from.errors)).toEqual(['animate needs a to, by or values'])
  for (const source of [{ to: '1' }, { by: '1' }, { values: '1; 2' }] as Record<
    string,
    string
  >[]) {
    expect(
      run(inGroup(animate({ attributeName: 'r', dur: 1, ...source }))).errors,
    ).toEqual([])
  }
})

it('a failing animation param is reported on its node and param and left out, and the shape still draws', () => {
  const { svg, errors } = run(
    spec({
      g: { type: 'g', children: ['c', 'r'] },
      c: { type: 'circle', params: { r: 5 }, children: ['a'] },
      a: animate({ attributeName: 'r', to: '{missing * 2}', dur: 'speed' }),
      r: { type: 'rect', params: { width: 4, height: 4 } },
    }),
    { speed: 2 },
  )
  expect(errors).toEqual([
    expect.objectContaining({
      component: 'c',
      node: 'a',
      param: 'to',
      message: expect.stringMatching(/Undefined symbol missing/),
    }),
  ])
  expect(svg).toContain(
    '<circle r="5">\n    <animate attributeName="r" dur="2s" />\n  </circle>',
  )
  expect(svg).toContain('<rect width="4" height="4" />')
})

it("shapes draw their animation children inside them, after a text shape's content", () => {
  for (const shape of [
    'rect',
    'circle',
    'ellipse',
    'line',
    'path',
    'polygon',
    'polyline',
    'text',
  ]) {
    expect(NODE_TYPES[shape]?.children).toBe('animation')
  }
  const { svg, errors } = run(
    spec({
      g: { type: 'g', children: ['c', 't'] },
      c: { type: 'circle', params: { r: 5 }, children: ['a1', 'a2'] },
      a1: animate({ attributeName: 'r', to: '8', dur: 1 }),
      a2: {
        type: 'animateTransform',
        params: { type: 'scale', to: '2', dur: 1 },
      },
      t: { type: 'text', params: { text: 'Hi', x: 1 }, children: ['a3'] },
      a3: animate({ attributeName: 'x', to: '9', dur: 1 }),
    }),
  )
  expect(errors).toEqual([])
  expect(svg).toBe(
    [
      '<g>',
      '  <circle r="5">',
      '    <animate attributeName="r" to="8" dur="1s" />',
      '    <animateTransform attributeName="transform" type="scale" to="2" dur="1s" />',
      '  </circle>',
      '  <text x="1">',
      '    Hi',
      '    <animate attributeName="x" to="9" dur="1s" />',
      '  </text>',
      '</g>',
      '',
    ].join('\n'),
  )
})

it("a shape reports a child that isn't an animation node, on that child, and leaves it out", () => {
  const { svg, errors } = run(
    spec({
      c: { type: 'circle', params: { r: 5 }, children: ['r', 'a'] },
      r: { type: 'rect', params: { width: 4 } },
      a: animate(valid),
    }),
  )
  expect(errors).toEqual([
    {
      component: 'c',
      node: 'r',
      message:
        'a circle node only takes animation nodes (animate, animateTransform), not a rect',
    },
  ])
  expect(svg).toBe(
    '<circle r="5">\n  <animate attributeName="r" to="20" dur="2s" />\n</circle>\n',
  )
})

it("each, grid and component nodes can't sit directly in a shape, while g, svg, each and grid accept animation nodes", () => {
  const icon: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'icon-id',
    root: 'n',
    nodes: { n: { type: 'rect', params: { width: 1 } } },
  }
  const refused = run(
    spec({
      c: { type: 'ellipse', params: { rx: 5 }, children: ['e', 'gr', 'i'] },
      e: { type: 'each', params: { list: '[1]' }, children: ['ea'] },
      ea: animate(valid),
      gr: { type: 'grid', params: { count: 1 }, children: ['ga'] },
      ga: animate(valid),
      i: { type: 'component', ref: 'icon-id' },
    }),
    {},
    { icon },
  )
  expect(
    refused.errors
      .filter((e) => !e.message.includes('not connected'))
      .map((e) => [e.node, e.message]),
  ).toEqual([
    [
      'e',
      'a ellipse node only takes animation nodes (animate, animateTransform), not a each',
    ],
    [
      'gr',
      'a ellipse node only takes animation nodes (animate, animateTransform), not a grid',
    ],
    [
      'i',
      'a ellipse node only takes animation nodes (animate, animateTransform), not a component',
    ],
  ])
  expect(refused.svg).toBe('<ellipse rx="5" />\n')

  const accepted = run(
    spec({
      s: { type: 'svg', children: ['sa', 'g', 'e', 'gr'] },
      sa: animate({ attributeName: 'width', to: '10', dur: 1 }),
      g: { type: 'g', children: ['gaa'] },
      gaa: animate({ attributeName: 'opacity', to: '0', dur: 1 }),
      e: { type: 'each', params: { list: '[1, 2]' }, children: ['ea'] },
      ea: animate({ attributeName: 'x', to: '{d}', dur: 1 }),
      gr: { type: 'grid', params: { count: 1 }, children: ['ga'] },
      ga: animate({ attributeName: 'y', to: '{n}', dur: 1 }),
    }),
  )
  expect(accepted.errors).toEqual([])
  expect(accepted.svg).toContain('<animate attributeName="width"')
  expect(accepted.svg).toContain('<g>\n    <animate attributeName="opacity"')
  expect(accepted.svg).toContain(
    '<animate attributeName="x" to="1" dur="1s" />',
  )
  expect(accepted.svg).toContain(
    '<animate attributeName="x" to="2" dur="1s" />',
  )
  expect(accepted.svg).toContain(
    '<animate attributeName="y" to="0" dur="1s" />',
  )
})

it('animation params read what their shape exposes, and expose on an animation node is reported as having no effect', () => {
  const { svg, errors } = run(
    spec({
      c: {
        type: 'circle',
        params: { r: '=size' },
        expose: { radius: 'r' },
        children: ['a'],
      },
      a: {
        type: 'animate',
        params: {
          attributeName: 'r',
          values: '{radius}; {radius * 1.1}; {radius}',
          dur: 'radius / 5',
        },
        expose: { speed: 'dur' },
      },
    }),
    { size: 10 },
  )
  expect(messages(errors)).toEqual(['expose has no effect on animate nodes'])
  expect(errors[0]).toMatchObject({ node: 'a' })
  expect(svg).toContain(
    '<animate attributeName="r" values="10; 11; 10" dur="2s" />',
  )
})
