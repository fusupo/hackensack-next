import { describe, expect, it } from 'vitest'
import { compile, parseTransform, SPEC_FORMAT, toSvgString } from './index.ts'
import type {
  ComponentSpec,
  Diagnostic,
  InputDecl,
  Library,
  NodeSpec,
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
