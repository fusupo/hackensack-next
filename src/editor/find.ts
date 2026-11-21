// Find node (#59): the nodes of one component that match what was typed in
// the graph view's find box, by label, type, definition name or id.

import { nodeLabel } from '@hackensack/engine'
import type { ComponentSpec } from '@hackensack/engine'

export interface FoundNode {
  id: string
  /** The node's label (`nodeLabel`), when it has one. */
  label?: string
  type: string
  /** Instances: the name of the definition they use, when it exists. */
  refName?: string
}

/**
 * The nodes of `spec` (and only its own, never those inside the definitions
 * its instances use) whose label, type, definition name or id contains
 * `query`, ignoring case. Label matches come first; within each group the
 * spec's node order is kept. A blank query finds nothing.
 */
export function findNodes(
  spec: ComponentSpec,
  query: string,
  /** Definition names by id (usage.ts `namesById`). */
  names: ReadonlyMap<string, string> = new Map(),
): FoundNode[] {
  const wanted = query.trim().toLowerCase()
  if (wanted === '') return []
  const byLabel: FoundNode[] = []
  const byOther: FoundNode[] = []
  for (const [id, node] of Object.entries(spec.nodes ?? {})) {
    const label = nodeLabel(node)
    const refName =
      node.type === 'component' && node.ref ? names.get(node.ref) : undefined
    const found: FoundNode = {
      id,
      type: node.type,
      ...(label !== undefined && { label }),
      ...(refName !== undefined && { refName }),
    }
    const has = (text: string | undefined) =>
      text !== undefined && text.toLowerCase().includes(wanted)
    if (has(label)) byLabel.push(found)
    else if (has(node.type) || has(refName) || has(id)) byOther.push(found)
  }
  return [...byLabel, ...byOther]
}

/** How a match reads in the list: "cloud · ellipse (w8)", "sun (n4)". */
export function describeFound(found: FoundNode): string {
  const kind =
    found.type === 'component' ? (found.refName ?? 'component') : found.type
  return `${found.label ? `${found.label} · ` : ''}${kind} (${found.id})`
}
