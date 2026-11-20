// A bundle: one component and every definition it reaches, plus optional
// default data, in one JSON-ready object. It is what the embeddable player
// loads (packages/player), made by `npm run bundle` and by the editor's
// Export for player. Pure: no file system, no DOM, no JSON calls; callers
// read and stringify.

import { indexById } from './spec.ts'
import type { ComponentSpec, Library } from './spec.ts'

export const BUNDLE_FORMAT = 'hackensack/bundle/1'

export interface Bundle {
  format: typeof BUNDLE_FORMAT
  /** The component drawn: a key of `components`, as `compile` takes it. */
  root: string
  /** Definitions by name. Instances inside them still refer to ids. */
  components: Record<string, ComponentSpec>
  /** Default data. Data given at render time overrides it input by input. */
  data?: Record<string, unknown>
}

export interface BundleProblem {
  message: string
}

/**
 * Bundles `root` with every definition it reaches through instance refs
 * (resolved by id), in a stable order: the root first, then the others in
 * the order they are reached. Each spec is copied without its editor-only
 * `editor` section. An unresolved ref is left as it is (the player shows a
 * missing component, as the editor does); an id two definitions claim takes
 * the first in the library's order, so the result is deterministic.
 * Throws when `root` isn't in the library.
 */
export function bundle(
  root: string,
  library: Library,
  data?: Record<string, unknown>,
): Bundle {
  if (!Object.hasOwn(library, root)) {
    throw new Error(`Unknown component "${root}"`)
  }
  const byId = indexById(library)
  const components: Record<string, ComponentSpec> = {}
  const queue = [root]
  while (queue.length > 0) {
    const name = queue.shift()!
    if (Object.hasOwn(components, name)) continue
    const spec = library[name]
    components[name] = withoutEditor(spec)
    // Every node, wired or loose: the compiler compiles them all.
    for (const node of Object.values(spec.nodes ?? {})) {
      if (node?.type !== 'component' || typeof node.ref !== 'string') continue
      const target = byId.get(node.ref)?.[0]
      if (target !== undefined && !Object.hasOwn(components, target)) {
        queue.push(target)
      }
    }
  }
  const result: Bundle = { format: BUNDLE_FORMAT, root, components }
  if (data !== undefined) result.data = data
  return result
}

function withoutEditor(spec: ComponentSpec): ComponentSpec {
  const copy = { ...spec }
  delete copy.editor
  return copy
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Checks a bundle read from outside (parsed JSON). Returns the bundle, or
 * the problems found, never throwing. It checks the bundle's own shape only:
 * what is wrong inside a definition is `compile`'s to report.
 */
export function readBundle(
  json: unknown,
):
  | { bundle: Bundle; problems?: undefined }
  | { bundle?: undefined; problems: BundleProblem[] } {
  if (!isPlainObject(json)) {
    return { problems: [{ message: 'A bundle must be a JSON object.' }] }
  }
  const problems: BundleProblem[] = []
  if (json.format !== BUNDLE_FORMAT) {
    problems.push({
      message: `Not a bundle: its format is ${JSON.stringify(json.format) ?? 'missing'}, expected "${BUNDLE_FORMAT}".`,
    })
  }
  const { root, components, data } = json
  if (typeof root !== 'string' || root === '') {
    problems.push({ message: 'The bundle has no root component name.' })
  }
  if (!isPlainObject(components)) {
    problems.push({ message: 'The bundle has no components.' })
  } else {
    for (const [name, spec] of Object.entries(components)) {
      if (!isPlainObject(spec)) {
        problems.push({ message: `Component "${name}" is not an object.` })
      }
    }
    if (
      typeof root === 'string' &&
      root !== '' &&
      !Object.hasOwn(components, root)
    ) {
      problems.push({
        message: `The root component "${root}" is not in the bundle.`,
      })
    }
  }
  if (data !== undefined && !isPlainObject(data)) {
    problems.push({ message: "The bundle's data must be an object." })
  }
  if (problems.length > 0) return { problems }
  return { bundle: json as unknown as Bundle }
}

/**
 * The data a bundle renders with: its default data with `given` laid over
 * it, one top-level input at a time. An input's value is replaced whole,
 * never merged into (a list or an object is one value). An input given as
 * `undefined` keeps its default; `null` is a value and replaces it.
 */
export function withDefaults(
  bundle: Pick<Bundle, 'data'>,
  given?: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...bundle.data }
  for (const [name, value] of Object.entries(given ?? {})) {
    if (value !== undefined) merged[name] = value
  }
  return merged
}
