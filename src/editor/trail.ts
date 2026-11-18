// The breadcrumb trail: which component definitions you entered, and through
// which instances. Double-clicking an instance enters its definition; a crumb
// goes back out. The first crumb is the picture being previewed, the last is
// the component being edited. See PLAN.md, "Compound nodes".

import type { Library } from '../engine/index.ts'
import { defaultComponent } from './projects.ts'
import { definitionName } from './usage.ts'

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
  const current = currentOf(trail)
  const node = Object.hasOwn(library, current)
    ? library[current]!.nodes[instanceId]
    : undefined
  if (!node || node.type !== 'component')
    return { error: `${instanceId} is not a component instance.` }
  if (!node.ref) return { error: `${instanceId} has no definition chosen.` }
  const name = definitionName(library, node.ref)
  if (!name)
    return {
      error: `Can't open ${instanceId}: its definition is missing (no component has the id "${node.ref}").`,
    }
  if (trail.some((c) => c.component === name))
    return { error: `${name} is already open further up the trail.` }
  return { trail: [...trail, { component: name, via: instanceId }] }
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
    if (!Object.hasOwn(library, crumb.component)) return trail.slice(0, i)
    if (i > 0) {
      const via = crumb.via
        ? library[trail[i - 1]!.component]?.nodes[crumb.via]
        : undefined
      if (
        via?.type !== 'component' ||
        definitionName(library, via.ref) !== crumb.component
      )
        return trail.slice(0, i)
    }
  }
  return trail
}

/**
 * The trail to show for a project after its library changed: `pruneTrail`,
 * or, when even the first crumb's component is gone (it was deleted), a
 * fresh trail on the project's default component.
 */
export function settleTrail(
  trail: Trail,
  project: Parameters<typeof defaultComponent>[0],
): Trail {
  const pruned = pruneTrail(trail, project.library)
  return pruned.length > 0 ? pruned : openTrail(defaultComponent(project))
}

/** The trail after component `from` was renamed to `to`. */
export function renameInTrail(trail: Trail, from: string, to: string): Trail {
  if (!trail.some((c) => c.component === from)) return trail
  return trail.map((c) => (c.component === from ? { ...c, component: to } : c))
}
