// The core compiles a bundle once (#16). Its own file, because the engine
// mock below applies to the whole file.

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as engine from '@hackensack/engine'
import type { ComponentSpec } from '@hackensack/engine'
import { expect, it, vi } from 'vitest'
import { createRenderer } from './core.ts'

vi.mock('@hackensack/engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('@hackensack/engine')>()
  return { ...original, compile: vi.fn(original.compile) }
})

it('the player core compiles a bundle once, however many times it renders', () => {
  const dir = join(
    import.meta.dirname,
    '../../../examples/weather-card/components',
  )
  const library: Record<string, ComponentSpec> = {}
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    library[basename(file, '.json')] = JSON.parse(
      readFileSync(join(dir, file), 'utf8'),
    ) as ComponentSpec
  }
  const compile = vi.mocked(engine.compile)
  compile.mockClear()
  const renderer = createRenderer(
    engine.bundle('weather-card', library, {
      temperature: 20,
      precip: 30,
      cloudCover: 40,
      wind: 10,
    }),
  )
  const first = renderer.render().markup
  const pictures = [5, 50, 90].map(
    (precip) => renderer.render({ precip }).markup,
  )
  expect(compile).toHaveBeenCalledTimes(1)
  // And the renders really differ: more rain, more drops.
  expect(new Set([first, ...pictures]).size).toBe(4)
})
