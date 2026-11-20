// The path node and its `{expression}` holes (#8).

import { describe, expect, it } from 'vitest'
import { compile, SPEC_FORMAT, toSvgString } from './index.ts'
import type { ComponentSpec, Diagnostic, InputDecl, NodeSpec } from './index.ts'

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
function run(s: ComponentSpec, data: Record<string, unknown> = {}) {
  const inputs: Record<string, InputDecl> = { ...s.inputs }
  for (const name of Object.keys(data)) inputs[name] ??= { type: 'any' }
  const program = compile('c', { c: { ...s, inputs } })
  const result = program.render(data)
  return {
    svg: toSvgString(result.output),
    errors: [...program.errors, ...result.errors],
  }
}

/** One path inside a group, next to a rect that should always be drawn. */
const pathSpec = (d: string | number | boolean, extra = {}) =>
  spec({
    g: { type: 'g', children: ['p', 'r'] },
    p: { type: 'path', params: { d, ...extra } },
    r: { type: 'rect', params: { width: 4, height: 4 } },
  })

/** The attribute `name` of the first `<tag>` in the SVG, unescaped as written. */
const attr = (svg: string, tag: string, name: string) =>
  new RegExp(`<${tag}\\b[^>]*?\\s${name}="([^"]*)"`).exec(svg)?.[1]

const messages = (errors: Diagnostic[]) => errors.map((e) => e.message)

describe('path node', () => {
  it('renders a path whose data has no holes exactly as written', () => {
    const d = 'M2 12a10 10 0 1 0 20 0z  m-1.5 0h3,4'
    const { svg, errors } = run(
      pathSpec(d, {
        fill: '#123456',
        stroke: '#000000',
        'stroke-width': 2,
        opacity: 0.5,
        transform: 'translate(1, 2)',
      }),
    )
    expect(errors).toEqual([])
    expect(svg).toContain(
      `<path d="${d}" fill="#123456" stroke="#000000" stroke-width="2" opacity="0.5" transform="translate(1, 2)" />`,
    )
  })

  it('passes fill-rule, stroke-linecap and stroke-linejoin through to the path', () => {
    const { svg, errors } = run(
      spec(
        {
          p: {
            type: 'path',
            params: {
              d: 'M 0 0 L 1 1',
              'fill-rule': 'evenodd',
              'stroke-linecap': 'round',
              'stroke-linejoin': '=join',
            },
          },
        },
        { join: { type: 'string', default: 'bevel' } },
      ),
    )
    expect(errors).toEqual([])
    expect(svg).toBe(
      '<path d="M 0 0 L 1 1" fill-rule="evenodd" stroke-linecap="round" stroke-linejoin="bevel" />\n',
    )
  })

  it('fills the holes in path data with numbers from the scope', () => {
    const { svg, errors } = run(
      pathSpec('M 0 0 L {w * 2} {h} L {size(l)} 0 Z'),
      { w: 10, h: 5, l: [1, 2, 3] },
    )
    expect(errors).toEqual([])
    // size(l) is a one-element list, unwrapped as in any number param.
    expect(attr(svg, 'path', 'd')).toBe('M 0 0 L 20 5 L 3 0 Z')
  })

  it("formats a hole's number to 6 decimals without a minus zero", () => {
    const { svg, errors } = run(pathSpec('M {1 / 3} {-0} L {0 * -1} {2.5e-7}'))
    expect(errors).toEqual([])
    expect(attr(svg, 'path', 'd')).toBe('M 0.333333 0 L 0 0')
  })

  it('substitutes holes literally, so adjacent holes need a separator', () => {
    const data = { x: 10, y: 20 }
    expect(attr(run(pathSpec('M{x}{y}'), data).svg, 'path', 'd')).toBe('M1020')
    expect(attr(run(pathSpec('M{x} {y}'), data).svg, 'path', 'd')).toBe(
      'M10 20',
    )
    expect(attr(run(pathSpec('M{x},{-y}'), data).svg, 'path', 'd')).toBe(
      'M10,-20',
    )
  })

  it('ignores a closing brace inside a quoted string in a hole', () => {
    const { svg, errors } = run(
      pathSpec(`M {count('}}')} {count("a}")} L { {a: 4}.a } 0`),
    )
    expect(errors).toEqual([])
    expect(attr(svg, 'path', 'd')).toBe('M 2 2 L 4 0')
  })

  it('takes the whole path data from an expression behind the = prefix', () => {
    const { svg, errors } = run(pathSpec('=shape'), { shape: 'M 1 1 L {x} Z' })
    expect(errors).toEqual([])
    // The expression's text is used as it is: holes in it aren't filled.
    expect(attr(svg, 'path', 'd')).toBe('M 1 1 L {x} Z')
    expect(attr(run(pathSpec('="M 0 0 h 5"')).svg, 'path', 'd')).toBe(
      'M 0 0 h 5',
    )
  })

  it("reports a path d that isn't text, raw or from an expression", () => {
    for (const raw of [5, true]) {
      const { svg, errors } = run(pathSpec(raw))
      expect(errors).toEqual([
        {
          component: 'c',
          node: 'p',
          param: 'd',
          message: 'expected path data like "M 0 0 L 10 10 Z"',
        },
      ])
      expect(svg).toContain('<path />')
    }
    for (const [d, message] of [
      ['=true', 'expected text, got boolean true'],
      ['=[1, 2]', 'expected text, got a list of 2'],
    ]) {
      const { svg, errors } = run(pathSpec(d!))
      expect(errors).toEqual([
        { component: 'c', node: 'p', param: 'd', message, path: [] },
      ])
      expect(svg).toContain('<path />')
      expect(svg).toContain('<rect width="4" height="4" />')
    }
    // A number from an expression is written as that number, as for text params.
    const five = run(pathSpec('=5'))
    expect(five.errors).toEqual([])
    expect(attr(five.svg, 'path', 'd')).toBe('5')
  })

  it('does not validate path data outside the holes', () => {
    const { svg, errors } = run(pathSpec('not a path <b> "q" & {1} Q'))
    expect(errors).toEqual([])
    // Not validated, but still escaped: the preview inserts this markup.
    expect(attr(svg, 'path', 'd')).toBe(
      'not a path &lt;b&gt; &quot;q&quot; &amp; 1 Q',
    )
  })

  it("reports an unclosed brace, a stray brace, an empty hole and a hole that doesn't parse when compiling, and still renders the rest", () => {
    const { svg, errors } = run(
      spec({
        g: { type: 'g', children: ['a', 'b', 'c', 'e', 'r'] },
        a: { type: 'path', params: { d: 'M 0 0 L {w' } },
        b: { type: 'path', params: { d: 'M 0 } 0' } },
        c: { type: 'path', params: { d: 'M {  } 0' } },
        e: { type: 'path', params: { d: 'M {w *} 0' } },
        r: { type: 'rect', params: { width: 4, height: 4 } },
      }),
      { w: 1 },
    )
    expect(errors.map((e) => [e.node, e.param, e.path])).toEqual([
      ['a', 'd', undefined],
      ['b', 'd', undefined],
      ['c', 'd', undefined],
      ['e', 'd', undefined],
    ])
    const [unclosed, stray, empty, parse] = messages(errors)
    expect(unclosed).toBe('unclosed "{" at position 9')
    expect(stray).toBe('unexpected "}" at position 5')
    expect(empty).toBe('empty hole {} at position 3')
    expect(parse).toMatch(/^\{w \*\}: /)
    expect(svg.match(/<path \/>/g)).toHaveLength(4)
    expect(svg).toContain('<rect width="4" height="4" />')
  })

  it("reports a hole that fails or isn't a number and still renders the rest", () => {
    const holes = ['nope + 1', '"x"', '[1, 2]', '1 / 0', '{a: 1}']
    const nodes: Record<string, NodeSpec> = {
      g: { type: 'g', children: [...holes.map((_, i) => `p${i}`), 'r'] },
      r: { type: 'rect', params: { width: 4, height: 4 } },
    }
    holes.forEach((hole, i) => {
      nodes[`p${i}`] = { type: 'path', params: { d: `M 0 0 L {${hole}} 0` } }
    })
    const { svg, errors } = run(spec(nodes))
    expect(errors.map((e) => [e.node, e.param])).toEqual(
      holes.map((_, i) => [`p${i}`, 'd']),
    )
    const found = messages(errors)
    expect(found[0]).toMatch(/^\{nope \+ 1\}: Undefined symbol nope/)
    expect(found.slice(1)).toEqual([
      '{"x"}: expected a number, got string "x"',
      '{[1, 2]}: expected a number, got a list of 2',
      '{1 / 0}: expected a finite number, got Infinity',
      '{{a: 1}}: expected a number, got an object',
    ])
    expect(svg.match(/<path \/>/g)).toHaveLength(holes.length)
    expect(svg).toContain('<rect width="4" height="4" />')
  })
})

/** One shape with `points`, next to a rect that should always be drawn. */
const pointsSpec = (
  points: string | number,
  type: 'polygon' | 'polyline' = 'polygon',
) =>
  spec({
    g: { type: 'g', children: ['p', 'r'] },
    p: { type, params: { points } },
    r: { type: 'rect', params: { width: 4, height: 4 } },
  })

/** The points a shape drew, or the problems if any. */
function drawn(
  points: string | number,
  data: Record<string, unknown> = {},
): string | undefined | string[] {
  const { svg, errors } = run(pointsSpec(points), data)
  if (errors.length > 0) return messages(errors)
  return attr(svg, 'polygon', 'points')
}

describe('polygon and polyline nodes', () => {
  it('renders a polygon and a polyline from a list of pairs in the data', () => {
    const style = {
      fill: '#ff0000',
      'stroke-linejoin': 'round',
      transform: 'translate(1, 2)',
    }
    const { svg, errors } = run(
      spec({
        g: { type: 'g', children: ['a', 'b'] },
        a: { type: 'polygon', params: { points: 'pts', ...style } },
        b: { type: 'polyline', params: { points: 'pts', ...style } },
      }),
      {
        pts: [
          [0, 0],
          [10, 0],
          [5, 8],
        ],
      },
    )
    expect(errors).toEqual([])
    for (const tag of ['polygon', 'polyline'])
      expect(svg).toContain(
        `<${tag} points="0,0 10,0 5,8" fill="#ff0000" stroke-linejoin="round" transform="translate(1, 2)" />`,
      )
  })

  it('builds points from lists with transpose and element-wise arithmetic', () => {
    expect(
      drawn('transpose([range(0, count(l) - 1) * 20, 100 - l * 10])', {
        l: [3, 5, 2],
      }),
    ).toBe('0,70 20,50 40,80')
    // Each number is written with at most 6 decimals and no minus zero.
    expect(drawn('transpose([[0, 1/3], [2/3, -0]])')).toBe(
      '0,0.666667 0.333333,0',
    )
  })

  it('draws nothing for an empty list and keeps a one-point list as a point', () => {
    const empty = run(pointsSpec('pts'), { pts: [] })
    expect(empty.errors).toEqual([])
    expect(empty.svg).toContain('<polygon />')
    expect(drawn('pts', { pts: [[1, 2]] })).toBe('1,2')
    expect(drawn('[[1, 2]]')).toBe('1,2')
  })

  it("reports points that aren't pairs of numbers, naming the entry", () => {
    expect(
      drawn('pts', {
        pts: [
          [0, 0],
          [1, 2, 3],
        ],
      }),
    ).toEqual(['points[1]: expected [x, y], got a list of 3'])
    expect(drawn('pts', { pts: [[0, 'a']] })).toEqual([
      'points[0]: expected [x, y] numbers, got string "a"',
    ])
    expect(drawn('pts', { pts: [5] })).toEqual([
      'points[0]: expected [x, y], got number 5',
    ])
    expect(drawn('[[0, 0], [0, 1 / 0]]')).toEqual([
      'points[1]: expected finite numbers, got Infinity',
    ])
    const { errors } = run(pointsSpec('pts'), { pts: [[0]] })
    expect(errors).toEqual([
      {
        component: 'c',
        node: 'p',
        param: 'points',
        message: 'points[0]: expected [x, y], got a list of 1',
        path: [],
      },
    ])
  })

  it("reports points that aren't a list and still renders the rest", () => {
    for (const [points, message] of [
      ['n', 'expected a list of [x, y] pairs, got number 3'],
      ['="abc"', 'expected a list of [x, y] pairs, got string "abc"'],
    ]) {
      const { svg, errors } = run(pointsSpec(points!, 'polyline'), { n: 3 })
      expect(errors).toEqual([
        { component: 'c', node: 'p', param: 'points', message, path: [] },
      ])
      expect(svg).toContain('<polyline />')
      expect(svg).toContain('<rect width="4" height="4" />')
    }
    // A raw number isn't a point list at all: a compile problem.
    const raw = run(pointsSpec(5))
    expect(raw.errors).toEqual([
      {
        component: 'c',
        node: 'p',
        param: 'points',
        message:
          'expected a list of [x, y] pairs, or points like "0,0 10,0 5,8"',
      },
    ])
    expect(raw.svg).toContain('<rect width="4" height="4" />')
  })

  it('reports a list of more than 10000 points', () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => [i, 0])
    expect(drawn('pts', { pts: pts(10_001) })).toEqual([
      'at most 10,000 points are drawn, got 10001',
    ])
    const most = drawn('pts', { pts: pts(10_000) })
    expect(typeof most).toBe('string')
    expect((most as string).split(' ')).toHaveLength(10_000)
  })

  it('reads a literal point string like "0,0 10,0 5,8"', () => {
    expect(drawn('0,0 10,0 5,8')).toBe('0,0 10,0 5,8')
    // Written back as normalised x,y pairs.
    expect(drawn('  0 0, 10 0\n 5 8 ')).toBe('0,0 10,0 5,8')
    expect(drawn('-1.5e1,+.5 1E2,-0')).toBe('-15,0.5 100,0')
  })

  it('fills holes in a literal point string', () => {
    expect(drawn('0,0 {w},0 {w / 2},{h}', { w: 10, h: 8 })).toBe('0,0 10,0 5,8')
    expect(drawn('{-w},{1/3}', { w: 2 })).toBe('-2,0.333333')
    expect(drawn('0,0 {w', { w: 1 })).toEqual(['unclosed "{" at position 5'])
    expect(drawn('0,0 {"a"},1', {})).toEqual([
      '{"a"}: expected a number, got string "a"',
    ])
  })

  it('reports an odd number of coordinates and non-numbers in a literal point string', () => {
    expect(drawn('0,0 10')).toEqual([
      'expected pairs of numbers, got 3 numbers; separate numbers with a space or comma',
    ])
    expect(drawn('5')).toEqual([
      'expected pairs of numbers, got 1 numbers; separate numbers with a space or comma',
    ])
    expect(drawn('10-5 0')).toEqual([
      '"10-5" isn\'t a number; separate numbers with a space or comma',
    ])
    expect(drawn('2e 1')).toEqual([
      '"2e" isn\'t a number; separate numbers with a space or comma',
    ])
  })

  it('reads a string as an expression unless it is only numbers and holes', () => {
    expect(drawn('pts', { pts: [[1, 1]] })).toBe('1,1')
    expect(drawn('[[0, 0], [1, 1]]')).toBe('0,0 1,1')
    // `e` and `e2` are names, not numbers: e is math.js's constant.
    expect(drawn('e')).toEqual([
      'expected a list of [x, y] pairs, got number 2.718281828459045',
    ])
    expect(drawn('e2', { e2: [[2, 2]] })).toBe('2,2')
    expect(drawn('{w},{w}', { w: 3 })).toBe('3,3')
  })

  it('forces an expression for points with a leading =', () => {
    expect(drawn('=pts', { pts: [[1, 2]] })).toBe('1,2')
    expect(drawn('=[[3, 4], [5, 6]]')).toBe('3,4 5,6')
    // Without = this would be a literal with one number.
    expect(drawn('=5')).toEqual([
      'expected a list of [x, y] pairs, got number 5',
    ])
  })
})
