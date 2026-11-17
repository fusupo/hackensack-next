// Presenting engine diagnostics in the editor.

import type { Diagnostic } from '../engine/index.ts'

/** Where a problem is, e.g. "spoke via n3 · s1.fill". */
export function describeLocation(d: Diagnostic): string {
  const via = d.path && d.path.length > 0 ? ` via ${d.path.join(' › ')}` : ''
  const where = d.node
    ? `${d.node}${d.param ? `.${d.param}` : ''}`
    : (d.param ?? '')
  return `${d.component}${via}${where ? ` · ${where}` : ''}`
}

/**
 * Problems on the nodes of `component` itself, keyed by node id, for marking
 * them in its graph. Problems inside instances (non-empty path) belong to the
 * instance's definition, so they are left out here.
 */
export function problemsByNode(
  problems: readonly Diagnostic[],
  component: string,
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const d of problems) {
    if (d.component !== component || (d.path?.length ?? 0) > 0 || !d.node)
      continue
    map.set(d.node, [
      ...(map.get(d.node) ?? []),
      d.param ? `${d.param}: ${d.message}` : d.message,
    ])
  }
  return map
}
