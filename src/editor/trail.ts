// The breadcrumb trail: which component definitions you entered, and through
// which instances. Double-clicking an instance enters its definition; a crumb
// goes back out. The first crumb is the picture being previewed, the last is
// the component being edited. See PLAN.md, "Compound nodes".

import type { Library } from '../engine/index.ts'

export interface Crumb {
  component: string
  /** The instance node id (in the previous crumb's component) entered through. Absent on the first crumb. */
  via?: string
}

export type Trail = readonly Crumb[]

/** A fresh trail with one component, e.g. after picking it from the Component menu. */
export function openTrail(name: string): Trail {
  return [{ component: name }]
}

/** The component being edited: the last crumb. */
export function currentOf(trail: Trail): string {
  return trail[trail.length - 1]?.component ?? ''
}

/** The component being compiled and previewed: the first crumb. */
export function topOf(trail: Trail): string {
  return trail[0]?.component ?? ''
}

/**
 * Enter the definition used by the instance `instanceId` of the current
 * component. Refused when the node isn't an instance, its definition doesn't
 * exist, or the definition is already on the trail (that would be a cycle).
 */
export function enterComponent(
  trail: Trail,
  library: Library,
  instanceId: string,
): { trail: Trail } | { error: string } {
  const node = library[currentOf(trail)]?.nodes[instanceId]
  if (!node || node.type !== 'component')
    return { error: `${instanceId} is not a component instance.` }
  if (!node.ref) return { error: `${instanceId} has no definition chosen.` }
  if (!library[node.ref])
    return {
      error: `Can't open ${node.ref}: there is no component named "${node.ref}".`,
    }
  if (trail.some((c) => c.component === node.ref))
    return { error: `${node.ref} is already open further up the trail.` }
  return { trail: [...trail, { component: node.ref, via: instanceId }] }
}

/** Go back out to the crumb at `index`. */
export function exitTo(trail: Trail, index: number): Trail {
  return trail.slice(0, Math.max(1, Math.min(index + 1, trail.length)))
}

/**
 * The trail up to the first crumb that no longer holds: its component is gone,
 * or the instance it was entered through no longer uses it.
 */
export function pruneTrail(trail: Trail, library: Library): Trail {
  for (let i = 0; i < trail.length; i++) {
    const crumb = trail[i]!
    if (!library[crumb.component]) return trail.slice(0, i)
    if (i > 0) {
      const via = crumb.via
        ? library[trail[i - 1]!.component]?.nodes[crumb.via]
        : undefined
      if (via?.type !== 'component' || via.ref !== crumb.component)
        return trail.slice(0, i)
    }
  }
  return trail
}
