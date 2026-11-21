// The authoring skill (#61): a Claude Code project skill that guides an AI
// writing a Hackensack spec. It must name the reference and the commands,
// and everything it names must exist.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..')
const SKILL = join(REPO, '.claude/skills/hackensack-author/SKILL.md')

it('the authoring skill names the reference, check and render, and everything it names exists', () => {
  expect(existsSync(SKILL)).toBe(true)
  const text = readFileSync(SKILL, 'utf8')
  // Front matter Claude Code reads to pick the skill.
  const front = text.match(/^---\n([\s\S]*?)\n---\n/)
  expect(front).not.toBeNull()
  expect(front![1]).toMatch(/^name: hackensack-author$/m)
  expect(front![1]).toMatch(/^description: \S.{40,}$/m)
  // The reference and the two commands.
  expect(text).toContain('docs/spec-reference.md')
  expect(text).toContain('npm run check -- ')
  expect(text).toContain('npm run render -- ')
  expect(text).toContain('--png')
  // Every file, script and example it names exists.
  expect(existsSync(join(REPO, 'docs/spec-reference.md'))).toBe(true)
  const scripts = (
    JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
  ).scripts
  const named = [...text.matchAll(/npm run ([a-z:-]+)/g)].map((m) => m[1])
  expect(named.length).toBeGreaterThan(0)
  for (const script of named) expect(scripts, script).toHaveProperty(script)
  const examples = [...text.matchAll(/examples\/([a-z0-9-]+)/g)].map(
    (m) => m[1],
  )
  expect(examples.length).toBeGreaterThan(5)
  for (const example of examples)
    expect(
      existsSync(join(REPO, 'examples', example, 'components')),
      example,
    ).toBe(true)
})
