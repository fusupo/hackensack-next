// The player's core (#16), in Node: it needs no DOM.

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { bundle, compile, SPEC_FORMAT, toSvgString } from '@hackensack/engine'
import type { ComponentSpec } from '@hackensack/engine'
import { expect, it } from 'vitest'
import { createRenderer, describeProblem } from './core.ts'

const EXAMPLES = join(import.meta.dirname, '../../../examples')

function loadLibrary(project: string): Record<string, ComponentSpec> {
  const dir = join(EXAMPLES, project, 'components')
  const library: Record<string, ComponentSpec> = {}
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    library[basename(file, '.json')] = JSON.parse(
      readFileSync(join(dir, file), 'utf8'),
    ) as ComponentSpec
  }
  return library
}

const sunCardSample = JSON.parse(
  readFileSync(join(EXAMPLES, 'sun-card/samples/sun-card.data.json'), 'utf8'),
) as Record<string, unknown>

/** A one-definition bundle: two rects, the second one's width from `w`. */
function rects(width: string) {
  const spec: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'aaaa0001',
    inputs: { w: { type: 'number', default: 5 } },
    root: 'root',
    nodes: {
      root: {
        type: 'svg',
        params: { width: 100, height: 100 },
        children: ['ok', 'bad'],
      },
      ok: { type: 'rect', params: { width: 10, height: 10, fill: 'green' } },
      bad: { type: 'rect', params: { width, height: 10, fill: 'red' } },
    },
  }
  return bundle('pic', { pic: spec })
}

it('the player core renders a bundle to the markup the engine gives, and the sun-card golden', () => {
  const library = loadLibrary('sun-card')
  const renderer = createRenderer(
    JSON.parse(JSON.stringify(bundle('sun-card', library, sunCardSample))),
  )
  expect(renderer.problems).toEqual([])
  const { markup, errors } = renderer.render()
  expect(errors).toEqual([])
  const golden = readFileSync(
    join(EXAMPLES, 'sun-card/expected/sun-card.svg'),
    'utf8',
  )
  expect(markup).toBe(golden)
  expect(markup).toBe(
    toSvgString(compile('sun-card', library).render(sunCardSample).output),
  )
})

it("render(data) overlays the data on the bundle's default data and each call renders afresh", () => {
  const renderer = createRenderer(
    bundle('sun-card', loadLibrary('sun-card'), { color: '#f5b942' }),
  )
  const fill = (markup: string) =>
    markup.match(/<circle r="10" fill="([^"]+)"/)?.[1]
  expect(fill(renderer.render().markup)).toBe('#f5b942')
  expect(fill(renderer.render({ color: 'teal' }).markup)).toBe('teal')
  // Not remembered: the next call is the defaults again.
  expect(fill(renderer.render().markup)).toBe('#f5b942')
  expect(fill(renderer.render({ color: undefined }).markup)).toBe('#f5b942')
})

it('a compile problem and a render problem are returned as problems while the valid part still draws', () => {
  // A syntax error is found when compiling.
  const compileFail = createRenderer(rects('=1 +'))
  expect(compileFail.problems).toHaveLength(1)
  expect(compileFail.problems[0]).toMatchObject({
    source: 'compile',
    component: 'pic',
    node: 'bad',
    param: 'width',
  })
  const drawn = compileFail.render()
  expect(drawn.errors).toEqual(compileFail.problems)
  expect(drawn.markup).toContain('fill="green"')
  expect(describeProblem(drawn.errors[0])).toMatch(/^pic › bad › width: /)

  // An unknown name is found when rendering.
  const renderFail = createRenderer(rects('=nope * w'))
  expect(renderFail.problems).toEqual([])
  const result = renderFail.render()
  expect(result.errors).toEqual([
    {
      source: 'render',
      component: 'pic',
      node: 'bad',
      param: 'width',
      message: 'Undefined symbol nope',
    },
  ])
  expect(result.markup).toContain('fill="green"')
  expect(result.markup).toContain('fill="red"')
  expect(result.markup).not.toMatch(/fill="red"[^>]*width=/)
})

it('an unreadable bundle gives problems and no markup', () => {
  for (const input of [null, 'svg', { format: 'hackensack/3' }, []]) {
    const renderer = createRenderer(input)
    expect(renderer.problems.length, JSON.stringify(input)).toBeGreaterThan(0)
    expect(renderer.problems.every((p) => p.source === 'bundle')).toBe(true)
    const { markup, errors } = renderer.render({ color: 'red' })
    expect(markup).toBe('')
    expect(errors).toEqual(renderer.problems)
  }
  // A missing root definition is the bundle's problem, too.
  const noRoot = createRenderer({ ...rects('5'), root: 'nothing' })
  expect(noRoot.render().markup).toBe('')
  expect(noRoot.problems[0].message).toMatch(/"nothing" is not in the bundle/)
})
