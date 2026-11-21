// Spec format v4: the JSON a component definition is stored as.
// See PLAN.md, "Spec format v4" and "Compound nodes".

export const SPEC_FORMAT = 'hackensack/4'

/**
 * Formats this version no longer reads, oldest first: v2 (refs were file
 * names) and v3 (nodes could `expose` params). Nothing upgrades them; the
 * engine reports them, and the file is rewritten by hand.
 */
export const OLDER_SPEC_FORMATS: readonly string[] = [
  'hackensack/2',
  'hackensack/3',
]

/**
 * A parameter value as written in a spec. JSON numbers and booleans are
 * literals. Strings are read according to the parameter's kind (numbers,
 * lengths and transforms are expressions; colors and strings are literal),
 * and a leading `=` always makes a string an expression.
 */
export type ParamValue = string | number | boolean

export type InputType =
  'number' | 'string' | 'boolean' | 'list' | 'object' | 'any'

/**
 * One declared input of a component (its interface).
 *
 * Resolution at each instance, in order: the instance's binding; then, if
 * `inherit` is set, a variable of the same name in the instance's scope; then
 * `default`. If none applies the input is missing, which is reported as an
 * error where the instance is.
 */
export interface InputDecl {
  /**
   * Defaults to 'any'. A value of the wrong type is rejected: reported, and
   * the input left unset (no fallback to the default).
   */
  type?: InputType
  default?: unknown
  /** Look the input up by name in the instance's surroundings when not bound. */
  inherit?: boolean
}

export interface NodeSpec {
  type: string
  /**
   * What the node stands for in the picture ("cloud", "left blade"), for
   * people only: drawing ignores it. Optional on any node, need not be unique.
   * Read it with `nodeLabel`, never by hand: a number counts as its text, and
   * anything else that isn't text is reported by `compile` (#59).
   */
  label?: string | number
  params?: Record<string, ParamValue>
  /** Ordered child node ids. Wires mean nesting: the graph is a tree. */
  children?: string[]
  /**
   * `vars` nodes only: named values for the node's subtree, name -> math.js
   * expression. Defined in key order: a value may read the names before it,
   * but not itself or a later one.
   */
  vars?: Record<string, string>
  /**
   * `component` nodes only: the `id` of the definition this instance uses
   * (not its name, so renaming a definition doesn't break its instances).
   */
  ref?: string
}

export interface ComponentSpec {
  format: typeof SPEC_FORMAT
  /**
   * Stable identity of this definition, unique within its library. Instances
   * refer to it by this id; the name (the file name) is only for people.
   */
  id: string
  inputs?: Record<string, InputDecl>
  root: string
  nodes: Record<string, NodeSpec>
  /** Editor-only data (node positions etc.). The engine ignores it. */
  editor?: Record<string, unknown>
}

/**
 * A node's label as text, or `undefined` when it has none. Text is trimmed and
 * blank text is no label; a finite number is its text (`3` -> "3"); a list,
 * an object, a boolean, `null` or anything else is no label (`compile`
 * reports the ones that aren't `null`, see `labelProblem`).
 */
export function nodeLabel(
  node: { label?: unknown } | undefined,
): string | undefined {
  const label: unknown = node?.label
  if (typeof label === 'string') {
    const text = label.trim()
    return text === '' ? undefined : text
  }
  if (typeof label === 'number' && Number.isFinite(label)) return String(label)
  return undefined
}

/**
 * Why a node's `label` can't be read, or `undefined` when it can (or there is
 * none). Missing, `null`, text and finite numbers are fine.
 */
export function labelProblem(node: { label?: unknown }): string | undefined {
  const label: unknown = node.label
  if (label === undefined || label === null || typeof label === 'string')
    return undefined
  if (typeof label === 'number')
    return Number.isFinite(label)
      ? undefined
      : 'label must be text, not a number like that'
  const what = Array.isArray(label)
    ? 'a list'
    : typeof label === 'boolean'
      ? String(label)
      : typeof label === 'object'
        ? 'an object'
        : `a ${typeof label}`
  return `label must be text, not ${what}`
}

/** Component definitions by name. A project's `components/<name>.json` files. */
export type Library = Readonly<Record<string, ComponentSpec>>

/**
 * Definition names by id. An id normally maps to one name; more than one
 * means the library is broken (two definitions claim the same id). Specs
 * without a string id are left out.
 */
export function indexById(library: Library): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const [name, spec] of Object.entries(library)) {
    const id: unknown = spec?.id
    if (typeof id !== 'string' || id === '') continue
    const names = index.get(id)
    if (names) names.push(name)
    else index.set(id, [name])
  }
  return index
}
