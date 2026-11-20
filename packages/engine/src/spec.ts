// Spec format v4: the JSON a component definition is stored as.
// See PLAN.md, "Spec format v4" and "Compound nodes".

export const SPEC_FORMAT = 'hackensack/4'

/** The previous format, whose refs were file names. The editor upgrades it on load. */
export const SPEC_FORMAT_V2 = 'hackensack/2'

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
  params?: Record<string, ParamValue>
  /** Ordered child node ids. Wires mean nesting: the graph is a tree. */
  children?: string[]
  /**
   * Opt-in: make some of this node's evaluated params visible to its subtree
   * as variables. Maps variable name -> param name.
   */
  expose?: Record<string, string>
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
