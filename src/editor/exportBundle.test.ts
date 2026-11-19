// Export for player (#16), in Node.

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BUNDLE_FORMAT, readBundle } from '@hackensack/engine'
import type { ComponentSpec } from '@hackensack/engine'
import { expect, it } from 'vitest'
import { exportBundle } from './exportBundle.ts'
import type { SampleData } from './projects.ts'

const SUN_CARD = join(import.meta.dirname, '../../examples/sun-card')

function load(kind: 'components' | 'samples') {
  const dir = join(SUN_CARD, kind)
  const files: Record<string, unknown> = {}
  for (const file of readdirSync(dir)) {
    files[basename(basename(file, '.json'), '.data')] = JSON.parse(
      readFileSync(join(dir, file), 'utf8'),
    )
  }
  return files
}

const library = load('components') as Record<string, ComponentSpec>
const samples = load('samples') as Record<string, SampleData>

it("exportBundle makes the top component's bundle with its sample as default data and names the file after it", () => {
  const { filename, text } = exportBundle({ library, samples }, 'sun-card')
  expect(filename).toBe('sun-card.bundle.json')
  expect(text.endsWith('}\n')).toBe(true)
  const read = readBundle(JSON.parse(text))
  expect(read.problems).toBeUndefined()
  const b = read.bundle!
  expect(b.format).toBe(BUNDLE_FORMAT)
  expect(b.root).toBe('sun-card')
  expect(Object.keys(b.components)).toEqual(['sun-card', 'sun'])
  expect(b.data).toEqual(samples['sun-card'])
  // Another component of the same project bundles alone, with its own sample.
  const sun = JSON.parse(exportBundle({ library, samples }, 'sun').text)
  expect(Object.keys(sun.components)).toEqual(['sun'])
  expect(sun.data).toEqual(samples.sun)
})

it('exportBundle uses the unsaved library and leaves data out when the component has no sample file', () => {
  // An edit not saved: sun's circle radius changed in memory only.
  const sun = structuredClone(library.sun)
  const circle = Object.values(sun.nodes).find((n) => n.type === 'circle')!
  circle.params = { ...circle.params, fill: '#123456' }
  const edited = { ...library, sun }
  const { text } = exportBundle({ library: edited, samples }, 'sun-card')
  expect(text).toContain('#123456')
  expect(JSON.stringify(library.sun)).not.toContain('#123456')
  // An edited sample in memory goes in too.
  const recoloured = exportBundle(
    { library, samples: { ...samples, 'sun-card': { color: 'teal' } } },
    'sun-card',
  )
  expect(JSON.parse(recoloured.text).data).toEqual({ color: 'teal' })
  // No sample file: no data key (the inputs' own defaults apply).
  const bare = JSON.parse(
    exportBundle({ library, samples: {} }, 'sun-card').text,
  )
  expect(bare).not.toHaveProperty('data')
})
