// The spec format reference (#61): generated from the node registry, and
// committed as docs/spec-reference.md, which must be the generated text.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import {
  compile,
  NODE_TYPES,
  SPEC_FORMAT,
  toSvgString,
} from '../packages/engine/src/index.ts'
import type {
  ComponentSpec,
  NodeTypeDef,
} from '../packages/engine/src/index.ts'
import {
  CHILDREN_HELP,
  describeRegistry,
  EXAMPLE_INDEX,
  KIND_HELP,
  main,
  REFERENCE_FILE,
  specReference,
} from './spec-reference.ts'

const REPO = join(import.meta.dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'hackensack-reference-'))
afterAll(() => rmSync(temp, { recursive: true, force: true }))

/** The reference's `### <type>` sections, by node type. */
function sections(text: string): Map<string, string> {
  const found = new Map<string, string>()
  const nodeTypes = text.slice(
    text.indexOf('## Node types'),
    text.indexOf('## Examples'),
  )
  const parts = nodeTypes.split(/^### /m).slice(1)
  for (const part of parts) {
    const end = part.search(/^## /m)
    const body = end === -1 ? part : part.slice(0, end)
    found.set(body.split('\n')[0].trim(), body)
  }
  return found
}

/** Checks the reference covers every type, param and kind of `nodeTypes`. */
function expectCovers(
  text: string,
  nodeTypes: Readonly<Record<string, NodeTypeDef>>,
) {
  const bySection = sections(text)
  const kinds = text.slice(
    text.indexOf('## Param kinds'),
    text.indexOf('## Node types'),
  )
  for (const help of Object.values(KIND_HELP)) expect(kinds).toContain(help)
  for (const [type, def] of Object.entries(nodeTypes)) {
    const section = bySection.get(type)
    expect(section, `section for ${type}`).toBeDefined()
    expect(section).toContain(CHILDREN_HELP[def.children])
    for (const [name, param] of Object.entries(def.params)) {
      const row = section!
        .split('\n')
        .find((line) => line.startsWith(`| ${name} |`))
      expect(row, `${type}.${name}`).toBeDefined()
      expect(row).toContain(`\`${param.kind}\``)
      if (param.default !== undefined)
        expect(row).toContain(`\`${param.default}\``)
      if (param.required) expect(row).toContain('required')
      for (const option of param.options ?? [])
        expect(row).toContain(`\`${option}\``)
      expect(KIND_HELP[param.kind], `${type}.${name}`).toBeTruthy()
    }
  }
}

it('the committed spec reference is the one generated from the node registry', () => {
  const committed = readFileSync(REFERENCE_FILE, 'utf8')
  expect(committed).toBe(specReference())
  // And `npm run reference -- --check` agrees, or says what to do.
  const err: string[] = []
  const io = { out: () => {}, err: (t: string) => err.push(t) }
  expect(main(['--check'], io)).toBe(0)
  expect(main(['--check'], io, join(temp, 'missing.md'))).toBe(1)
  expect(err).toEqual([
    'reference: docs/spec-reference.md is out of date; run npm run reference\n',
  ])
})

it('the spec reference covers every node type, param and kind of the registry', () => {
  const text = specReference()
  expectCovers(text, NODE_TYPES)
  // Every node type, and the format it documents.
  expect([...sections(text).keys()]).toEqual(Object.keys(NODE_TYPES))
  expect(text).toContain(`"format": "${SPEC_FORMAT}"`)
  // The plain-data view has every param too.
  const described = describeRegistry()
  expect(described.map((t) => t.type)).toEqual(Object.keys(NODE_TYPES))
  for (const info of described)
    expect(info.params.map((p) => p.name)).toEqual(
      Object.keys(NODE_TYPES[info.type].params),
    )
})

it('changing the node registry changes the spec reference', () => {
  const changed: Record<string, NodeTypeDef> = {
    ...NODE_TYPES,
    circle: {
      ...NODE_TYPES.circle,
      params: {
        ...NODE_TYPES.circle.params,
        glow: {
          kind: 'number',
          group: 'presentation',
          default: 3,
          options: ['3', '4'],
        },
      },
    },
    star: {
      tag: 'polygon',
      params: { spikes: { kind: 'number', group: 'geometry', required: true } },
      children: 'animation',
    },
  }
  const text = specReference(changed)
  expect(text).not.toBe(specReference())
  expectCovers(text, changed)
  const circle = sections(text).get('circle')!
  expect(circle).toContain('| glow | `number` | `3` |')
  const star = sections(text).get('star')!
  expect(star).toContain('| spikes | `number` |  | required |')
  expect(star).toContain(CHILDREN_HELP.animation)
  // The registry the engine uses is untouched.
  expect(NODE_TYPES).not.toHaveProperty('star')
})

it('the spec reference names example folders that exist, and its example spec draws with no problems', () => {
  for (const { example } of EXAMPLE_INDEX)
    expect(
      existsSync(join(REPO, 'examples', example, 'components')),
      example,
    ).toBe(true)
  const text = specReference()
  const block = text.match(/```json\n([\s\S]*?)\n```/)
  expect(block).not.toBeNull()
  const spec = JSON.parse(block![1]) as ComponentSpec
  const program = compile('example', { example: spec })
  const { output, errors } = program.render({ rain: 20 })
  expect([...program.errors, ...errors]).toEqual([])
  expect(toSvgString(output).match(/<circle /g)).toHaveLength(4)
})
