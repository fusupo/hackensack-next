// Where each component is used: the instance nodes that reference it, across
// every component in the project's library. Editing inside a definition
// changes all of them, so the editor shows this count on instances, in the
// Component menu, the palette and the breadcrumb hint, and lists the uses in
// the inspector (#2).
//
// Counts are worked out from the in-memory library, so unsaved edits count.
// Only direct uses count: if `card` uses `sun` and `scene` uses `card`, `sun`
// has one use (in card), not two. Nodes that aren't connected to their
// component's root still count; they are still in the file. Instances with an
// empty ref, or a ref that matches no component's id, are not counted for
// anything.
//
// Refs hold definition ids (spec format v3, #3); everything the editor shows
// uses the definition's name, which `namesById` / `definitionName` look up.

import { indexById } from '@hackensack/engine'
import type { ComponentSpec } from '@hackensack/engine'

type Specs = Readonly<Record<string, ComponentSpec>>

/**
 * Definition names by id, for the ids that belong to exactly one definition.
 * (An id claimed by two definitions resolves to neither; the engine reports it.)
 */
export function namesById(library: Specs): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  for (const [id, owners] of indexById(library))
    if (owners.length === 1) names.set(id, owners[0]!)
  return names
}

/** The name of the definition an instance's `ref` points at, if there is one. */
export function definitionName(
  library: Specs,
  ref: string | undefined,
): string | undefined {
  return ref ? namesById(library).get(ref) : undefined
}

/** One instance node: the component it sits in and its node id. */
export interface Use {
  component: string
  node: string
}

/** Uses by definition name. Definitions nothing uses are absent. */
export type Usage = ReadonlyMap<string, readonly Use[]>

export function usageOf(library: Specs): Usage {
  const names = namesById(library)
  const usage = new Map<string, Use[]>()
  for (const [component, spec] of Object.entries(library)) {
    for (const [node, n] of Object.entries(spec.nodes ?? {})) {
      const name =
        n.type === 'component' && n.ref ? names.get(n.ref) : undefined
      if (!name) continue
      let uses = usage.get(name)
      if (!uses) usage.set(name, (uses = []))
      uses.push({ component, node })
    }
  }
  return usage
}

/** How many instance nodes use `name`; 0 when nothing does. */
export function usageCount(usage: Usage, name: string): number {
  return usage.get(name)?.length ?? 0
}

/** Uses grouped by the component they sit in, in first-seen order. */
export function usesByComponent(
  uses: readonly Use[],
): { component: string; nodes: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const { component, node } of uses) {
    let nodes = groups.get(component)
    if (!nodes) groups.set(component, (nodes = []))
    nodes.push(node)
  }
  return [...groups].map(([component, nodes]) => ({ component, nodes }))
}

/** "3 instances", "1 instance". */
export function instancesText(count: number): string {
  return `${count} ${count === 1 ? 'instance' : 'instances'}`
}
