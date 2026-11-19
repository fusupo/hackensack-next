// Upgrading spec files from format v2 (refs are file names) to v3 (refs are
// definition ids). Works per file: v3 files are left as they are, so a v2
// file dropped into a v3 project still points at the existing definitions.

import { SPEC_FORMAT, SPEC_FORMAT_V2 } from '@hackensack/engine'
import type { ComponentSpec, NodeSpec } from '@hackensack/engine'
import { defaultRandom, idsIn, newId } from './ids.ts'
import type { RandomBytes } from './ids.ts'

export interface Upgraded {
  library: Record<string, ComponentSpec>
  /** Names of the files that changed, in library order. */
  changed: string[]
}

const isV2 = (spec: unknown) =>
  typeof spec === 'object' &&
  spec !== null &&
  (spec as { format?: unknown }).format === SPEC_FORMAT_V2

/**
 * Give every v2 file an id, rewrite its name refs to the ids of the
 * definitions they name, and mark it v3. Refs that name no definition are
 * left as they are (they stay dangling, as before).
 */
export function upgradeLibrary(
  library: Readonly<Record<string, unknown>>,
  random: RandomBytes = defaultRandom,
): Upgraded {
  const specs = library as Readonly<Record<string, ComponentSpec>>
  const old = Object.keys(specs).filter((name) => isV2(specs[name]))
  if (old.length === 0) return { library: { ...specs }, changed: [] }

  // First every v2 file gets an id, so refs between v2 files can resolve.
  const taken = idsIn(specs)
  const idOf = new Map<string, string>()
  for (const [name, spec] of Object.entries(specs)) {
    if (typeof spec?.id === 'string' && spec.id !== '') idOf.set(name, spec.id)
  }
  for (const name of old) {
    if (idOf.has(name)) continue
    const id = newId(taken, random)
    taken.push(id)
    idOf.set(name, id)
  }

  const upgraded: Record<string, ComponentSpec> = { ...specs }
  for (const name of old) {
    const spec = specs[name]!
    const nodes: Record<string, NodeSpec> = {}
    for (const [id, node] of Object.entries(spec.nodes ?? {})) {
      const target =
        node.type === 'component' && node.ref && Object.hasOwn(specs, node.ref)
          ? idOf.get(node.ref)
          : undefined
      nodes[id] = target ? { ...node, ref: target } : node
    }
    const { format: _format, id: _id, ...rest } = spec
    upgraded[name] = {
      format: SPEC_FORMAT,
      id: idOf.get(name)!,
      ...rest,
      nodes,
    }
  }
  return { library: upgraded, changed: old }
}
