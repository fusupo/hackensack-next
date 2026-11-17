// Presenting engine diagnostics in the editor.

import type { Diagnostic } from '../engine/index.ts'
import type { Trail } from './trail.ts'

/**
 * The problems as seen from the component at the end of `trail`. Render
 * problems carry a path of instance ids measured from the top of the trail
 * (the component being rendered); this keeps only those under the instances
 * entered through, with that prefix removed, so they read as if the entered
 * component had been rendered on its own. Compile problems have no path and
 * pass through. At the top of the trail nothing changes.
 */
export function problemsAt(
  problems: readonly Diagnostic[],
  trail: Trail,
): readonly Diagnostic[] {
  const prefix = trail.slice(1).map((c) => c.via ?? '')
  if (prefix.length === 0) return problems
  return problems.flatMap((d) => {
    if (!d.path) return [d]
    if (d.path.length < prefix.length) return []
    if (prefix.some((id, i) => d.path![i] !== id)) return []
    return [{ ...d, path: d.path.slice(prefix.length) }]
  })
}

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
