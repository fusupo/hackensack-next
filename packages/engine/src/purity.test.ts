// The engine's purity guard rails (PLAN.md principle 5) are config files at
// the repo root that name the engine's folder. If the engine moves and a path
// goes stale, the guard silently stops guarding, so these tests pin them to
// packages/engine and check the sources directly as well.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '../../..')
const ENGINE_SRC = join(REPO, 'packages/engine/src')

/** Reads a JSON file that may hold comments (tsconfig style). */
function readJsonc(file: string): Record<string, unknown> {
  const text = readFileSync(join(REPO, file), 'utf8')
    // Whole-line comments only: globs like `src/**/*.test.ts` hold `/*`.
    .replace(/^\s*\/\*.*\*\/\s*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
  return JSON.parse(text) as Record<string, unknown>
}

interface Override {
  files: string[]
  rules?: Record<string, unknown>
}

/** The import patterns an oxlint override bans, flattened. */
function bannedGroups(override: Override): string[] {
  const rule = override.rules?.['no-restricted-imports']
  if (!Array.isArray(rule)) return []
  const options = rule[1] as { patterns?: { group: string[] }[] } | undefined
  return (options?.patterns ?? []).flatMap((p) => p.group)
}

it("the engine's guard rails follow it to packages/engine, and its sources import nothing from the UI, the editor or the player", () => {
  // tsconfig.engine.json type-checks the engine without the DOM or any
  // ambient types, so `document` or `window` is a compile error there.
  const tsconfig = readJsonc('tsconfig.engine.json')
  const options = tsconfig.compilerOptions as Record<string, unknown>
  expect(options.lib).toEqual(['ES2023'])
  expect(options.types).toEqual([])
  expect(tsconfig.include).toEqual(['packages/engine/src'])

  // .oxlintrc.json bans UI, editor and player imports in the engine.
  const lint = readJsonc('.oxlintrc.json')
  const overrides = lint.overrides as Override[]
  const engine = overrides.find((o) => o.files.includes('packages/engine/**'))
  expect(engine, 'an oxlint override for packages/engine/**').toBeDefined()
  const groups = bannedGroups(engine!)
  for (const banned of [
    'react',
    'react-dom',
    '@xyflow/*',
    '**/editor/**',
    '@hackensack/player',
  ]) {
    expect(groups).toContain(banned)
  }
  // No override still points at the old place.
  expect(overrides.flatMap((o) => o.files)).not.toContain('src/engine/**')

  // And the sources themselves: no UI, editor or player imports, and no use
  // of the browser's globals (`nodes.ts` uses "document" as a group name, so
  // only member use counts).
  const sources = readdirSync(ENGINE_SRC).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  )
  expect(sources).toContain('index.ts')
  for (const file of sources) {
    const text = readFileSync(join(ENGINE_SRC, file), 'utf8')
    const specifiers = [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    )
    for (const spec of specifiers) {
      expect(spec, `${file} imports ${spec}`).not.toMatch(
        /^(react|react-dom)(\/|$)|^@xyflow\/|editor|player/,
      )
    }
    const code = text.replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, "''")
    expect(code, `${file} uses a browser global`).not.toMatch(
      /\b(document|window|navigator)\s*[.[(]/,
    )
  }
})
