import { describe, expect, it } from 'vitest'
import { compile, parseTransform, SPEC_FORMAT, toSvgString } from './index.ts'
import type {
  ComponentSpec,
  Diagnostic,
  InputDecl,
  Library,
  NodeSpec,
  ParamValue,
  SvgElement,
  SvgNode,
} from './index.ts'

/**
 * A component spec whose root is the first node listed. Its id is left empty
 * for `run` to fill in; `withId` sets one.
 */
function spec(
  nodes: Record<string, NodeSpec>,
  inputs: Record<string, InputDecl> = {},
): ComponentSpec {
  return {
    format: SPEC_FORMAT,
    id: '',
    inputs,
    root: Object.keys(nodes)[0]!,
    nodes,
  }
}

const withId = (id: string, s: ComponentSpec): ComponentSpec => ({ ...s, id })

/**
 * Give every spec without an id its name as id, so refs in these tests can
 * read like names. (Real ids are random; `compile` only ever matches ids.)
 */
function named(library: Library): Library {
  return Object.fromEntries(
    Object.entries(library).map(([name, s]) => [
      name,
      s.id ? s : withId(name, s),
    ]),
  )
}

/** Compile + render; returns the SVG and every diagnostic (compile and render). */
function run(
  library: Library,
  name: string,
  data: Record<string, unknown> = {},
) {
  const program = compile(name, named(library))
  const result = program.render(data)
  return {
    svg: toSvgString(result.output),
    errors: [...program.errors, ...result.errors],
  }
}

const messages = (errors: Diagnostic[]) => errors.map((e) => e.message)

describe('spec format', () => {
  it('is hackensack/3', () => {
    expect(SPEC_FORMAT).toBe('hackensack/3')
  })

  it('rejects a hackensack/2 spec', () => {
    const { errors } = run(
      {
        c: {
          ...spec({ n: { type: 'g' } }),
          format: 'hackensack/2' as typeof SPEC_FORMAT,
        },
      },
      'c',
    )
    expect(errors).toContainEqual({
      component: 'c',
      message:
        '"hackensack/2" is an older spec format whose refs are names; open it in the editor to upgrade it to "hackensack/3"',
    })
  })

  it('reports a wrong format', () => {
    const { errors } = run(
      {
        c: {
          ...spec({ n: { type: 'g' } }),
          format: 'other' as typeof SPEC_FORMAT,
        },
      },
      'c',
    )
    expect(messages(errors)).toContain(
      'unknown spec format "other" (expected "hackensack/3")',
    )
  })
})

describe('scope within a component', () => {
  it('sees ancestors’ variables, nearest first', () => {
    const lib = {
      c: spec(
        {
          a: { type: 'g', children: ['b'] },
          b: { type: 'each', params: { list: 'xs', as: 'x' }, children: ['r'] },
          r: { type: 'rect', params: { x: 'x', y: 'top' } },
        },
        { xs: { type: 'list' }, top: { type: 'number' } },
      ),
    }
    const { svg, errors } = run(lib, 'c', { xs: [1, 2], top: 7 })
    expect(errors).toEqual([])
    expect(svg).toContain('<rect x="1" y="7" />')
    expect(svg).toContain('<rect x="2" y="7" />')
  })

  it('lets an inner each shadow an outer name', () => {
    const lib = {
      c: spec({
        a: { type: 'each', params: { list: '[10, 20]' }, children: ['b'] },
        b: { type: 'each', params: { list: '[1]' }, children: ['r'] },
        r: { type: 'rect', params: { x: 'd', y: 'i' } },
      }),
    }
    const { svg, errors } = run(lib, 'c')
    expect(errors).toEqual([])
    // Inner d = 1 hides the outer d (10, 20).
    expect(svg.match(/<rect x="1" y="0" \/>/g)).toHaveLength(2)
  })

  it('does not let a node read its parent’s params unless they are exposed', () => {
    const base = (expose?: Record<string, string>) => ({
      c: spec({
        s: {
          type: 'svg',
          params: { width: 300 },
          children: ['r'],
          ...(expose && { expose }),
        },
        r: { type: 'rect', params: { width: 'cardW / 2' } },
      }),
    })
    const hidden = run(base(), 'c')
    expect(hidden.errors).toEqual([
      {
        component: 'c',
        node: 'r',
        param: 'width',
        message: 'Undefined symbol cardW',
        path: [],
      },
    ])
    const exposed = run(base({ cardW: 'width' }), 'c')
    expect(exposed.errors).toEqual([])
    expect(exposed.svg).toContain('<rect width="150" />')
  })
})

describe('component instances', () => {
  const sun = spec(
    {
      g: { type: 'g', children: ['c'] },
      c: {
        type: 'circle',
        params: { r: 'radius', fill: '=palette', cx: 'secret' },
      },
    },
    {
      radius: { type: 'number', default: 20 },
      palette: { type: 'string', inherit: true },
    },
  )

  it('binds inputs, falls back to defaults, and inherits declared names', () => {
    const lib = {
      sun,
      scene: spec(
        {
          g: { type: 'g', children: ['a', 'b'] },
          a: { type: 'component', ref: 'sun', params: { radius: '5' } },
          b: { type: 'component', ref: 'sun' },
        },
        { palette: { type: 'string' }, secret: { type: 'number' } },
      ),
    }
    const { svg, errors } = run(lib, 'scene', { palette: 'gold', secret: 99 })
    expect(svg).toContain('<circle r="5" fill="gold" />')
    expect(svg).toContain('<circle r="20" fill="gold" />')
    // `secret` is in the caller's scope but not declared by sun: invisible inside.
    expect(svg).not.toContain('99')
    expect(errors).toEqual([
      {
        component: 'sun',
        node: 'c',
        param: 'cx',
        message: 'Undefined symbol secret',
        path: ['a'],
      },
      {
        component: 'sun',
        node: 'c',
        param: 'cx',
        message: 'Undefined symbol secret',
        path: ['b'],
      },
    ])
  })

  it('prefers an explicit binding over inheriting', () => {
    const lib = {
      sun,
      scene: spec(
        { a: { type: 'component', ref: 'sun', params: { palette: 'red' } } },
        { palette: { type: 'string' } },
      ),
    }
    expect(run(lib, 'scene', { palette: 'gold' }).svg).toContain('fill="red"')
  })

  it('reports a missing inherited input at that instance only; the rest still renders', () => {
    const lib = {
      sun,
      scene: spec({
        g: { type: 'g', children: ['a', 'r'] },
        a: { type: 'component', ref: 'sun' },
        r: { type: 'rect', params: { width: 10 } },
      }),
    }
    const { svg, errors } = run(lib, 'scene')
    expect(svg).toContain('<rect width="10" />')
    expect(svg).toContain('<circle r="20" />') // fill omitted: palette is missing
    expect(errors).toContainEqual({
      component: 'scene',
      node: 'a',
      param: 'palette',
      message:
        'input "palette" isn\'t set, and there\'s no "palette" in scope here to inherit',
      path: [],
    })
  })

  it('reports missing required inputs, unknown bindings and wrong types', () => {
    const lib = {
      dot: spec(
        { c: { type: 'circle', params: { r: 'size' } } },
        { size: { type: 'number' } },
      ),
      scene: spec({
        g: { type: 'g', children: ['a', 'b', 'c'] },
        a: { type: 'component', ref: 'dot' },
        b: {
          type: 'component',
          ref: 'dot',
          params: { size: 3, colour: 'red' },
        },
        c: { type: 'component', ref: 'dot', params: { size: '"big"' } },
      }),
    }
    const found = messages(run(lib, 'scene').errors)
    expect(found).toContain('missing required input "size"')
    expect(found).toContain('dot has no input named "colour"')
    expect(found).toContain('expected a number, got string "big"')
  })

  it('rejects input values of the wrong type, without falling back to the default', () => {
    const tiles = spec(
      {
        e: { type: 'each', params: { list: 'xs' }, children: ['r'] },
        r: { type: 'rect', params: { x: 'd', fill: '=tone' } },
      },
      {
        xs: { type: 'list', default: [1] },
        tone: { type: 'string', inherit: true, default: 'grey' },
      },
    )
    const lib = {
      tiles,
      scene: spec(
        {
          g: { type: 'g', children: ['a', 'b'] },
          a: { type: 'component', ref: 'tiles', params: { xs: '7' } },
          b: { type: 'component', ref: 'tiles' },
        },
        { tone: { type: 'any' } },
      ),
    }

    // From top-level data: `xs` is a number, not a list.
    const top = run({ tiles }, 'tiles', { xs: 5, tone: 'red' })
    expect(top.svg).toBe('')
    expect(top.errors).toEqual([
      {
        component: 'tiles',
        param: 'xs',
        message:
          'input "xs" should be a list, got number 5, so it was left unset',
        path: [],
      },
      {
        component: 'tiles',
        node: 'e',
        param: 'list',
        message: 'Undefined symbol xs',
        path: [],
      },
    ])

    // From a binding (a) and from inheritance (both a and b): rejected at the instance.
    const scene = run(lib, 'scene', { tone: 42 })
    const found = messages(scene.errors)
    expect(found).toContain(
      'input "xs" should be a list, got number 7, so it was left unset',
    )
    expect(found).toContain(
      'input "tone" should be a string, got number 42, so it was left unset',
    )
    // b's xs falls back to its default [1]; its fill is omitted rather than defaulting to grey.
    expect(scene.svg).toBe('<g>\n  <rect x="1" />\n</g>\n')
  })

  it('reports unknown refs and cycles without hanging', () => {
    const lib = {
      a: spec({ x: { type: 'component', ref: 'b' } }),
      b: spec({
        g: { type: 'g', children: ['y', 'z'] },
        y: { type: 'component', ref: 'a' },
        z: { type: 'component', ref: 'nope' },
      }),
    }
    const { svg, errors } = run(lib, 'a')
    expect(messages(errors)).toEqual([
      'component cycle: a → b → a',
      'no component with id "nope" in the library',
    ])
    expect(svg).toBe('<g />\n')
  })
})

describe('definition ids', () => {
  const dot = spec(
    { c: { type: 'circle', params: { r: 'r' } } },
    {
      r: { type: 'number', default: 1 },
    },
  )

  it('resolves an instance ref as a definition id', () => {
    const library: Library = {
      dot: withId('k3f9a2c1', dot),
      scene: withId(
        'b0b0b0b0',
        spec({
          g: { type: 'g', children: ['a'] },
          a: { type: 'component', ref: 'k3f9a2c1', params: { r: '5' } },
        }),
      ),
    }
    const program = compile('scene', library)
    expect(program.errors).toEqual([])
    expect([...program.components.keys()]).toEqual(['scene', 'dot'])
    const { output, errors } = program.render()
    expect(errors).toEqual([])
    expect(toSvgString(output)).toBe('<g>\n  <circle r="5" />\n</g>\n')
  })

  it('reports a ref that matches no definition id, including a bare name', () => {
    const library: Library = {
      dot: withId('k3f9a2c1', dot),
      scene: withId(
        'b0b0b0b0',
        spec({
          g: { type: 'g', children: ['a', 'b', 'c'] },
          a: { type: 'component', ref: 'dot' },
          b: { type: 'component', ref: 'ffffffff' },
          c: { type: 'rect', params: { width: 4 } },
        }),
      ),
    }
    const program = compile('scene', library)
    expect(program.errors).toEqual([
      {
        component: 'scene',
        node: 'a',
        message: 'no component with id "dot" in the library',
      },
      {
        component: 'scene',
        node: 'b',
        message: 'no component with id "ffffffff" in the library',
      },
    ])
    // The dangling instances render nothing; the rest of the picture still does.
    expect(toSvgString(program.render().output)).toBe(
      '<g>\n  <rect width="4" />\n</g>\n',
    )
  })

  it('reports two definitions sharing an id', () => {
    const library: Library = {
      dot: withId('same', dot),
      blob: withId('same', dot),
      scene: withId(
        'b0b0b0b0',
        spec({
          g: { type: 'g', children: ['a'] },
          a: { type: 'component', ref: 'same' },
        }),
      ),
    }
    expect(compile('scene', library).errors).toEqual([
      {
        component: 'scene',
        node: 'a',
        message: 'id "same" is used by more than one component (dot, blob)',
      },
    ])
    // Compiling one of them directly reports the clash on the definition itself.
    expect(messages([...compile('dot', library).errors])).toEqual([
      'id "same" is also used by blob',
    ])
  })

  it('reports a definition with no id', () => {
    const { errors } = compile('c', { c: spec({ n: { type: 'g' } }) })
    expect(errors).toEqual([
      {
        component: 'c',
        message: 'component has no "id"; instances can\'t refer to it',
      },
    ])
  })

  it("doesn't mistake built-in object names for definitions", () => {
    const { errors } = compile('constructor', {})
    expect(messages([...errors])).toEqual([
      'no component named "constructor" in the library',
    ])
  })
})

describe('errors stay local', () => {
  it('omits only the attribute whose expression fails', () => {
    const lib = {
      c: spec({
        r: { type: 'rect', params: { x: 'nope + 1', y: 2, width: '3 +' } },
      }),
    }
    const { svg, errors } = run(lib, 'c')
    expect(svg).toBe('<rect y="2" />\n')
    expect(errors).toEqual([
      expect.objectContaining({ node: 'r', param: 'width' }), // parse error, found at compile time
      {
        component: 'c',
        node: 'r',
        param: 'x',
        message: 'Undefined symbol nope',
        path: [],
      },
    ])
  })

  it('reports structural problems', () => {
    const lib = {
      c: spec({
        a: { type: 'g', children: ['b', 'b', 'missing'] },
        b: { type: 'blob' },
        r: { type: 'rect', params: { colour: 'red' }, children: ['b'] },
      }),
    }
    const found = messages(run(lib, 'c').errors)
    expect(found).toEqual(
      expect.arrayContaining([
        'unknown node type "blob"',
        'node is used in more than one place; a node can only have one parent',
        'node "missing" doesn\'t exist',
        'node is not connected to the root and is not rendered',
      ]),
    )
  })

  it('reports each over something that is not a list, once', () => {
    const lib = {
      c: spec({
        a: { type: 'each', params: { list: '[1, 2]' }, children: ['b'] },
        b: { type: 'each', params: { list: '5' }, children: [] },
      }),
    }
    expect(messages(run(lib, 'c').errors)).toEqual([
      'each needs a list, got number 5',
    ])
  })

  it("reports an invalid each binding name and falls back to that name's default only", () => {
    const lib = {
      c: spec({
        a: {
          type: 'each',
          params: { list: '[5]', as: '1x', index: 'k' },
          children: ['r'],
        },
        r: { type: 'rect', params: { x: 'd', y: 'k' } },
      }),
    }
    const { svg, errors } = run(lib, 'c')
    expect(errors).toEqual([
      {
        component: 'c',
        node: 'a',
        param: 'as',
        message: '"1x" isn\'t a valid variable name',
      },
    ])
    // `as` fell back to `d`; the valid custom index `k` was kept.
    expect(svg).toBe('<rect x="5" y="0" />\n')
  })
})

describe('param values', () => {
  const one = (
    params: NodeSpec['params'],
    type = 'rect',
    data: Record<string, unknown> = {},
  ) =>
    run({ c: spec({ n: { type, params } }, { v: {} }) }, 'c', { v: 4, ...data })

  it('reads lengths as expressions with an optional % or px unit', () => {
    expect(one({ x: '100%', y: 'v * 2px', width: 'v / 8' }).svg).toBe(
      '<rect x="100%" y="8px" width="0.5" />\n',
    )
  })

  it('reads colors and strings literally unless they start with =', () => {
    // math.js joins strings with concat(); "+" would try to add them as numbers.
    expect(one({ fill: '#fff', stroke: '=concat("#", "abc")' }).svg).toBe(
      '<rect fill="#fff" stroke="#abc" />\n',
    )
  })

  it('rounds numbers to 6 decimals and never prints -0', () => {
    expect(one({ x: '1 / 3', y: '-0' }).svg).toBe(
      '<rect x="0.333333" y="0" />\n',
    )
  })

  it('renders text content, escaped', () => {
    expect(one({ text: 'a < b & c', x: 1 }, 'text').svg).toBe(
      '<text x="1">a &lt; b &amp; c</text>\n',
    )
  })

  it('rejects unknown params', () => {
    expect(messages(one({ colour: 'red' }).errors)).toEqual([
      'unknown param "colour" for rect',
    ])
  })
})

describe('transforms', () => {
  it('splits steps and top-level arguments', () => {
    expect(
      parseTransform('translate(sin(a) * 2, max(1, 2)) rotate(45)'),
    ).toEqual([
      { fn: 'translate', args: ['sin(a) * 2', 'max(1, 2)'] },
      { fn: 'rotate', args: ['45'] },
    ])
  })

  it('explains bad transforms', () => {
    expect(() => parseTransform('spin(4)')).toThrow(
      'unknown transform function "spin"',
    )
    expect(() => parseTransform('rotate(1, 2)')).toThrow(
      'rotate() takes 1 or 3 arguments, got 2',
    )
    expect(() => parseTransform('translate(1, 2')).toThrow(
      'missing ")" for translate',
    )
  })
})

describe('expression safety', () => {
  it('forbids assignment and dangerous math.js functions', () => {
    const lib = {
      c: spec(
        { r: { type: 'rect', params: { x: 'v = 3', y: 'evaluate("1")' } } },
        { v: {} },
      ),
    }
    expect(messages(run(lib, 'c', { v: 1 }).errors)).toEqual([
      'expressions can\'t assign variables (tried to set "v")',
      'evaluate() is not available in expressions',
    ])
  })

  it('still disables every dangerous math.js function', () => {
    const calls = {
      import: 'import({})',
      createUnit: 'createUnit("furlong")',
      evaluate: 'evaluate("1")',
      parse: 'parse("1")',
      compile: 'compile("1")',
      simplify: 'simplify("x + x")',
      derivative: 'derivative("x^2", "x")',
      resolve: 'resolve("x")',
    }
    for (const [name, call] of Object.entries(calls)) {
      const lib = { c: spec({ r: { type: 'rect', params: { x: call } } }) }
      expect(messages(run(lib, 'c').errors)).toEqual([
        `${name}() is not available in expressions`,
      ])
    }
  })

  it('cannot redefine a helper through import()', () => {
    const lib = {
      c: spec({ r: { type: 'rect', params: { x: 'import({ clamp: 1 })' } } }),
    }
    expect(messages(run(lib, 'c').errors)).toEqual([
      'import() is not available in expressions',
    ])
  })
})

// Expression helpers (#7): remap, clamp and mix.

/** One rect with these params, rendered with `data`, each key declared as an input. */
const drawRect = (
  params: NodeSpec['params'],
  data: Record<string, unknown> = {},
) =>
  run(
    {
      c: spec(
        { n: { type: 'rect', params } },
        Object.fromEntries(Object.keys(data).map((k) => [k, {}])),
      ),
    },
    'c',
    data,
  )

describe('remap', () => {
  it('maps linearly between two ranges', () => {
    const { svg, errors } = drawRect(
      {
        x: 'remap(-10, -10, 40, 100, 20)',
        y: 'remap(v, -10, 40, 100, 20)',
        width: 'remap(40, -10, 40, 100, 20)',
      },
      { v: 15 },
    )
    expect(errors).toEqual([])
    expect(svg).toBe('<rect x="100" y="60" width="20" />\n')
  })

  it('extrapolates beyond the input range', () => {
    const { svg, errors } = drawRect({
      x: 'remap(60, -10, 40, 100, 20)',
      y: 'remap(-35, -10, 40, 100, 20)',
    })
    expect(errors).toEqual([])
    expect(svg).toBe('<rect x="-12" y="140" />\n')
  })

  it('accepts reversed ranges', () => {
    const { svg, errors } = drawRect({
      x: 'remap(15, 40, -10, 20, 100)',
      y: 'remap(5, 10, 0, 0, 100)',
      width: 'remap(2, 0, 10, 100, 0)',
    })
    expect(errors).toEqual([])
    expect(svg).toBe('<rect x="60" y="50" width="80" />\n')
  })

  it('reports equal fromMin and fromMax and still renders the rest', () => {
    const { svg, errors } = drawRect(
      { x: 'remap(v, 5, 5, 0, 1)', y: 2 },
      { v: 5 },
    )
    expect(svg).toBe('<rect y="2" />\n')
    expect(errors).toEqual([
      {
        component: 'c',
        node: 'n',
        param: 'x',
        message: 'remap() needs fromMin and fromMax to differ, both are 5',
        path: [],
      },
    ])
  })
})

describe('clamp', () => {
  it('limits a value to min and max', () => {
    const { svg, errors } = drawRect({
      x: 'clamp(-5, 0, 10)',
      y: 'clamp(5, 0, 10)',
      width: 'clamp(15, 0, 10)',
    })
    expect(errors).toEqual([])
    expect(svg).toBe('<rect x="0" y="5" width="10" />\n')
  })

  it('allows min equal to max and reports min greater than max', () => {
    const { svg, errors } = drawRect({
      x: 'clamp(7, 3, 3)',
      y: 'clamp(5, 10, 0)',
    })
    expect(svg).toBe('<rect x="3" />\n')
    expect(errors).toEqual([
      expect.objectContaining({
        node: 'n',
        param: 'y',
        message: 'clamp() needs min <= max, got min 10 and max 0',
      }),
    ])
  })

  it('keeps clamp working after a failed import()', () => {
    const { svg, errors } = drawRect({
      x: 'import({ clamp: 1 })',
      y: 'clamp(5, 0, 3)',
    })
    expect(messages(errors)).toEqual([
      'import() is not available in expressions',
    ])
    expect(svg).toBe('<rect y="3" />\n')
  })
})

describe('helper arguments', () => {
  it('unwraps a one-element list such as size(l)', () => {
    const { svg, errors } = drawRect(
      { x: 'remap(size(l), 0, 6, 0, 60)', y: 'clamp(size(l), 0, 2)' },
      { l: [1, 2, 3] },
    )
    expect(errors).toEqual([])
    expect(svg).toBe('<rect x="30" y="2" />\n')
  })
})

// Origin tracking (#4): the editor's preview highlights what one instance drew.
// These sit outside any describe so their names are exactly the titles below.

const originLibrary = (): Library =>
  named({
    dot: spec(
      { c: { type: 'circle', params: { r: 'r' } } },
      { r: { type: 'number', default: 1 } },
    ),
    pair: spec({
      g: { type: 'g', children: ['d1', 'd2'] },
      d1: { type: 'component', ref: 'dot', params: { r: '2' } },
      d2: { type: 'component', ref: 'dot', params: { r: '3' } },
    }),
    scene: spec({
      root: { type: 'g', children: ['a', 'p', 'r'] },
      a: { type: 'component', ref: 'dot', params: { r: '5' } },
      p: { type: 'component', ref: 'pair' },
      r: { type: 'rect', params: { width: '1', height: '1' } },
    }),
  })

/** Every element in the output, depth first. */
function elements(nodes: readonly SvgNode[]): SvgElement[] {
  return nodes.flatMap((n) =>
    typeof n === 'string' ? [] : [n, ...elements(n.children)],
  )
}

it('tags elements drawn by an instance with the instance path when origins are tracked', () => {
  const { output, errors } = compile('scene', originLibrary()).render(
    {},
    { trackOrigins: true },
  )
  expect(errors).toEqual([])
  const [root] = output as SvgElement[]
  // Elements of the top-level component itself have no origin.
  expect(root!.origin).toBeUndefined()
  const rect = elements(output).find((e) => e.tag === 'rect')
  expect(rect?.origin).toBeUndefined()
  // The circle drawn by instance `a`.
  const fromA = elements(output).find(
    (e) => e.tag === 'circle' && e.attrs.r === '5',
  )
  expect(fromA?.origin).toEqual(['a'])
  // `pair`'s own <g>, drawn by instance `p`.
  const pairGroup = root!.children[1] as SvgElement
  expect(pairGroup.tag).toBe('g')
  expect(pairGroup.origin).toEqual(['p'])
})

it('tags elements drawn by a nested instance with the longer path', () => {
  const { output } = compile('scene', originLibrary()).render(
    {},
    { trackOrigins: true },
  )
  const circle = (r: string) =>
    elements(output).find((e) => e.tag === 'circle' && e.attrs.r === r)
  expect(circle('2')?.origin).toEqual(['p', 'd1'])
  expect(circle('3')?.origin).toEqual(['p', 'd2'])
})

it('tracked and untracked renders serialize identically and only the tracked render carries origins', () => {
  const program = compile('scene', originLibrary())
  const tracked = program.render({}, { trackOrigins: true })
  const untracked = program.render({})
  expect(toSvgString(tracked.output)).toBe(toSvgString(untracked.output))
  expect(tracked.errors).toEqual(untracked.errors)
  expect(elements(tracked.output).some((e) => e.origin !== undefined)).toBe(
    true,
  )
  for (const e of elements(untracked.output))
    expect(Object.hasOwn(e, 'origin')).toBe(false)
})

describe('grid', () => {
  /** A top-level component: a <g> holding the grid `gr` (drawing `cell`) and a sibling rect. */
  const gridded = (
    params: NodeSpec['params'],
    cell: NodeSpec = { type: 'rect', params: { width: 4, height: 4 } },
    inputs: Record<string, InputDecl> = { v: { default: 0 } },
  ) => ({
    c: spec(
      {
        s: { type: 'g', children: ['gr', 'sib'] },
        gr: { type: 'grid', params, children: ['cell'] },
        cell,
        sib: { type: 'circle', params: { r: 1 } },
      },
      inputs,
    ),
  })
  const translates = (svg: string) =>
    [...svg.matchAll(/transform="translate\(([^)]*)\)"/g)].map((m) => m[1])

  it('lays out grid cells row by row in translated groups', () => {
    const { output, errors } = compile(
      'c',
      named(gridded({ count: 5, columns: 2, spacing: 10 })),
    ).render({})
    expect(errors).toEqual([])
    const svg = toSvgString(output)
    expect(translates(svg)).toEqual([
      '0, 0',
      '10, 0',
      '0, 10',
      '10, 10',
      '0, 20',
    ])
    // Each cell is its own <g> holding one copy of the child, which has no position of its own.
    const [root] = output as SvgElement[]
    const cells = root!.children.slice(0, 5) as SvgElement[]
    for (const cell of cells) {
      expect(cell.tag).toBe('g')
      expect(Object.keys(cell.attrs)).toEqual(['transform'])
      expect(cell.children).toEqual([
        { tag: 'rect', attrs: { width: '4', height: '4' }, children: [] },
      ])
    }
    expect(root!.children[5]).toMatchObject({ tag: 'circle' })
  })

  it('uses the column spacing for rows unless rowSpacing is given', () => {
    const same = run(gridded({ count: 3, columns: 2, spacing: 8 }), 'c')
    expect(same.errors).toEqual([])
    expect(translates(same.svg)).toEqual(['0, 0', '8, 0', '0, 8'])
    const own = run(
      gridded({ count: 3, columns: 2, spacing: 8, rowSpacing: -12 }),
      'c',
    )
    expect(own.errors).toEqual([])
    expect(translates(own.svg)).toEqual(['0, 0', '8, 0', '0, -12'])
    // Column 0 with a negative spacing prints 0, never -0.
    const up = run(gridded({ count: 2, columns: 1, spacing: -5 }), 'c')
    expect(translates(up.svg)).toEqual(['0, 0', '0, -5'])
  })

  it("gives a grid's children column, row and index variables with configurable names", () => {
    const defaults = run(
      gridded(
        { count: 3, columns: 2 },
        {
          type: 'rect',
          params: { x: 'col', y: 'row', width: 'n', height: 'v' },
        },
      ),
      'c',
      { v: 7 },
    )
    expect(defaults.errors).toEqual([])
    expect(defaults.svg).toContain('<rect x="0" y="0" width="0" height="7" />')
    expect(defaults.svg).toContain('<rect x="1" y="0" width="1" height="7" />')
    expect(defaults.svg).toContain('<rect x="0" y="1" width="2" height="7" />')

    const custom = run(
      gridded(
        { count: 3, columns: 2, col: 'c', row: 'r', index: 'k' },
        { type: 'rect', params: { x: 'c', y: 'r', width: 'k + 1' } },
      ),
      'c',
    )
    expect(custom.errors).toEqual([])
    expect(custom.svg).toContain('<rect x="1" y="0" width="2" />')
    expect(custom.svg).toContain('<rect x="0" y="1" width="3" />')

    // Inside an each, the grid's default index name doesn't hide the each's `i`.
    const nested = run(
      {
        c: spec({
          e: { type: 'each', params: { list: '[10, 20]' }, children: ['gr'] },
          gr: { type: 'grid', params: { count: 1 }, children: ['r'] },
          r: { type: 'rect', params: { x: 'i', y: 'n' } },
        }),
      },
      'c',
    )
    expect(nested.errors).toEqual([])
    expect(nested.svg).toContain('<rect x="0" y="0" />')
    expect(nested.svg).toContain('<rect x="1" y="0" />')
  })

  it("passes a grid's column to a component instance through its binding", () => {
    const lib = {
      dot: spec(
        // The definition can't see the grid's `col`; only what is bound to it.
        { d: { type: 'circle', params: { cx: 'x', cy: 'col' } } },
        { x: { type: 'number' } },
      ),
      c: spec({
        gr: { type: 'grid', params: { count: 3 }, children: ['inst'] },
        inst: { type: 'component', ref: 'dot', params: { x: 'col * 2' } },
      }),
    }
    const { svg, errors } = run(lib, 'c')
    expect(svg).toContain('<circle cx="0" />')
    expect(svg).toContain('<circle cx="2" />')
    expect(svg).toContain('<circle cx="4" />')
    expect(errors).toEqual([
      {
        component: 'dot',
        node: 'd',
        param: 'cy',
        message: 'Undefined symbol col',
        path: ['inst'],
      },
    ])
  })

  it('reports clashing or invalid grid variable names and uses the defaults', () => {
    const cell: NodeSpec = {
      type: 'rect',
      params: { x: 'col', y: 'row', width: 'n' },
    }
    const invalid = run(gridded({ count: 2, col: '1x', row: 'y' }, cell), 'c')
    expect(invalid.errors).toEqual([
      {
        component: 'c',
        node: 'gr',
        param: 'col',
        message: '"1x" isn\'t a valid variable name',
      },
    ])
    // All three fell back to the defaults (`row` too, though `y` was valid), and the grid still draws.
    expect(invalid.svg).toContain('<rect x="1" y="0" width="1" />')

    const clash = run(gridded({ count: 2, col: 'a', row: 'a' }, cell), 'c')
    expect(clash.errors).toEqual([
      {
        component: 'c',
        node: 'gr',
        message:
          "a grid's column, row and index names must differ (got a, a, n); using col, row, n",
      },
    ])
    expect(clash.svg).toContain('<rect x="1" y="0" width="1" />')

    // A custom name can clash with another name's default.
    const withDefault = run(gridded({ count: 2, index: 'col' }, cell), 'c')
    expect(messages(withDefault.errors)).toEqual([
      "a grid's column, row and index names must differ (got col, row, col); using col, row, n",
    ])
    expect(withDefault.svg).toContain('<rect x="1" y="0" width="1" />')
  })

  it('floors a fractional grid count and draws nothing for zero', () => {
    const at = (v: number) => run(gridded({ count: 'v' }), 'c', { v })
    expect(translates(at(3.5).svg)).toEqual(['0, 0', '20, 0', '40, 0'])
    expect(at(3.5).errors).toEqual([])
    for (const v of [0.9, 0]) {
      const { svg, errors } = at(v)
      expect(errors).toEqual([])
      expect(translates(svg)).toEqual([])
      expect(svg).toContain('<circle r="1" />')
    }
  })

  it('reports a negative, non-numeric or oversized grid count and still renders the rest', () => {
    const at = (count: ParamValue, data = {}) =>
      run(gridded({ count }), 'c', data)
    const problem = (message: string) => [
      { component: 'c', node: 'gr', param: 'count', message, path: [] },
    ]
    const negative = at('v', { v: -1 })
    expect(negative.errors).toEqual(problem("count can't be negative, got -1"))
    expect(translates(negative.svg)).toEqual([])
    expect(negative.svg).toContain('<circle r="1" />')

    const text = at('v', { v: 'many' })
    expect(text.errors).toEqual(problem('expected a number, got string "many"'))
    expect(translates(text.svg)).toEqual([])
    expect(text.svg).toContain('<circle r="1" />')

    const huge = at(10001)
    expect(huge.errors).toEqual(
      problem('a grid draws at most 10000 cells, got 10001'),
    )
    expect(translates(huge.svg)).toEqual([])
    expect(huge.svg).toContain('<circle r="1" />')

    const most = at(10000)
    expect(most.errors).toEqual([])
    expect(translates(most.svg)).toHaveLength(10000)
  })

  it('reports a grid without a count, with unknown params or with fewer than one column', () => {
    const missing = run(gridded({ columns: 3 }), 'c')
    expect(missing.errors).toEqual([
      {
        component: 'c',
        node: 'gr',
        param: 'count',
        message: 'grid needs a count to repeat over',
      },
    ])
    expect(translates(missing.svg)).toEqual([])
    expect(missing.svg).toContain('<circle r="1" />')

    // An unknown param is reported and ignored; the grid still draws.
    const unknown = run(gridded({ count: 2, colour: 'red' }), 'c')
    expect(unknown.errors).toEqual([
      {
        component: 'c',
        node: 'gr',
        param: 'colour',
        message: 'unknown param "colour" for grid',
      },
    ])
    expect(translates(unknown.svg)).toEqual(['0, 0', '20, 0'])

    const narrow = run(gridded({ count: 2, columns: 0.5 }), 'c')
    expect(narrow.errors).toEqual([
      {
        component: 'c',
        node: 'gr',
        param: 'columns',
        message: 'a grid needs at least one column, got 0.5',
        path: [],
      },
    ])
    expect(translates(narrow.svg)).toEqual([])
    expect(narrow.svg).toContain('<circle r="1" />')
  })

  it('draws nothing for a grid whose param fails, and reports it once', () => {
    const lib = {
      c: spec({
        s: { type: 'g', children: ['e', 'sib'] },
        e: { type: 'each', params: { list: '[1, 2]' }, children: ['gr'] },
        gr: {
          type: 'grid',
          params: { count: 2, spacing: 'nope' },
          children: ['r'],
        },
        r: { type: 'rect', params: { width: 1 } },
        sib: { type: 'circle', params: { r: 1 } },
      }),
    }
    const { svg, errors } = run(lib, 'c')
    expect(errors).toEqual([
      {
        component: 'c',
        node: 'gr',
        param: 'spacing',
        message: 'Undefined symbol nope',
        path: [],
      },
    ])
    expect(translates(svg)).toEqual([])
    expect(svg).not.toContain('<rect')
    expect(svg).toContain('<circle r="1" />')
  })

  it('draws nothing for a grid whose param does not parse, and reports it once at compile', () => {
    const program = compile('c', named(gridded({ count: 2, spacing: '1 +' })))
    expect(program.errors).toEqual([
      expect.objectContaining({ component: 'c', node: 'gr', param: 'spacing' }),
    ])
    expect(program.errors).toHaveLength(1)
    const result = program.render({})
    expect(result.errors).toEqual([])
    const svg = toSvgString(result.output)
    // No cells at all: no fallback to the default spacing.
    expect(translates(svg)).toEqual([])
    expect(svg).not.toContain('<rect')
    expect(svg).toContain('<circle r="1" />')
  })

  it("tags a grid's cell groups with the instance path when origins are tracked", () => {
    const lib = named({
      tiles: spec({
        gr: { type: 'grid', params: { count: 2 }, children: ['r'] },
        r: { type: 'rect', params: { width: 1 } },
      }),
      scene: spec({
        root: { type: 'g', children: ['inst', 'top'] },
        inst: { type: 'component', ref: 'tiles' },
        top: { type: 'grid', params: { count: 2 }, children: ['c'] },
        c: { type: 'circle', params: { r: 1 } },
      }),
    })
    const program = compile('scene', lib)
    const tracked = program.render({}, { trackOrigins: true })
    const untracked = program.render({})
    expect(tracked.errors).toEqual([])
    expect(toSvgString(tracked.output)).toBe(toSvgString(untracked.output))
    const [root] = tracked.output as SvgElement[]
    const cells = root!.children as SvgElement[]
    expect(cells.map((c) => c.attrs.transform)).toEqual([
      'translate(0, 0)',
      'translate(20, 0)',
      'translate(0, 0)',
      'translate(20, 0)',
    ])
    // The instance's grid cells carry its path; the top-level grid's don't.
    expect(cells[0]!.origin).toEqual(['inst'])
    expect(cells[1]!.origin).toEqual(['inst'])
    expect(cells[2]!.origin).toBeUndefined()
    expect(cells[3]!.origin).toBeUndefined()
    for (const e of elements(untracked.output))
      expect(Object.hasOwn(e, 'origin')).toBe(false)
  })
})
