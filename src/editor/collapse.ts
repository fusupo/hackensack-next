// Collapse to component (#14): turn one node and everything below it into a
// new definition, and put one instance of it where the node was. Every
// variable the subtree reads from its surroundings becomes an input of the
// new definition under the same name, bound at the instance to that name, so
// no expression in the subtree is rewritten and the picture doesn't change.
// Pure functions; projectHistory.ts records the operation.

import {
  childProblem,
  eachNames,
  exposedNames,
  gridNames,
  NODE_TYPES,
  paramNames,
  SPEC_FORMAT,
  takesChildren,
} from '../engine/index.ts'
import type {
  ComponentSpec,
  InputDecl,
  Library,
  NodeSpec,
  ParamValue,
} from '../engine/index.ts'
import { scopeFrames } from './scope.ts'
import { definitionName } from './usage.ts'

const has = <T>(record: Readonly<Record<string, T>> | undefined, key: string) =>
  record !== undefined && Object.hasOwn(record, key)

/** `nodeId` and every node below it, the node first, depth first. */
export function subtreeOf(spec: ComponentSpec, nodeId: string): string[] {
  const ids: string[] = []
  const visit = (id: string) => {
    if (ids.includes(id) || !has(spec.nodes, id)) return
    ids.push(id)
    for (const child of spec.nodes[id]!.children ?? []) visit(child)
  }
  visit(nodeId)
  return ids
}

/**
 * Why `nodeId` can't be collapsed, if it can't. The root is the whole
 * component, and an instance is one already; a node not connected to the
 * root (a loose node) can be collapsed, and its instance stays loose.
 */
export function collapseProblem(
  spec: ComponentSpec,
  nodeId: string,
): string | undefined {
  if (!has(spec.nodes, nodeId)) return `There is no node "${nodeId}".`
  if (nodeId === spec.root)
    return 'The root is the whole component; use Duplicate to copy it.'
  if (spec.nodes[nodeId]!.type === 'component')
    return 'It is already an instance of a component.'
  // Its instance couldn't stay inside a shape, which takes animation nodes only.
  if (NODE_TYPES[spec.nodes[nodeId]!.type]?.animation)
    return 'An animation belongs inside a shape; collapse the shape instead.'
  // A broken graph: a node below it is also wired to a node outside it, or
  // the root is below it. The engine reports both; fix them first.
  const inside = new Set(subtreeOf(spec, nodeId))
  if (inside.has(spec.root))
    return 'The root is below it; fix the wiring first.'
  for (const [id, node] of Object.entries(spec.nodes)) {
    if (inside.has(id)) continue
    if ((node.children ?? []).some((c) => c !== nodeId && inside.has(c)))
      return 'A node below it is also wired somewhere else; fix the wiring first.'
  }
  return undefined
}

/** The names a node binds for its children (never for its own params). */
function bindsForChildren(node: NodeSpec): string[] {
  if (node.type === 'each') return eachNames(node)
  if (node.type === 'grid') return gridNames(node)
  return exposedNames(node).map((e) => e.name)
}

/**
 * The names `node` looks up in its scope: what its params read (an
 * instance's by the types of its definition's inputs) and, for an instance,
 * every `inherit` input it doesn't bind, which is looked up by name.
 */
function namesUsedBy(node: NodeSpec, library: Library): string[] {
  if (node.type !== 'component') return paramNames(node)
  const target = definitionName(library, node.ref)
  const inputs =
    target !== undefined && has(library, target)
      ? (library[target]!.inputs ?? {})
      : undefined
  const names = paramNames(node, inputs)
  for (const [name, decl] of Object.entries(inputs ?? {}))
    if (decl.inherit && !has(node.params, name) && !names.includes(name))
      names.push(name)
  return names
}

/** The inputs a collapse gives the new definition. */
export interface CollapseInputs {
  /** By name, in the order the subtree first uses them. */
  inputs: Record<string, InputDecl>
  /** The ones whose value comes from an input of the containing component. */
  fromComponent: string[]
}

/**
 * The variables `nodeId`'s subtree reads from outside it: names its params
 * (and inherited inputs of instances in it) use, that aren't bound inside the
 * subtree on the way down and that its surroundings define (the scope at
 * `nodeId`, which also leaves out math.js functions, constants and units).
 * Each is typed as the containing component's input when it is one, else
 * `any`; no default.
 */
export function collapseInputs(
  library: Library,
  component: string,
  nodeId: string,
): CollapseInputs {
  const spec = library[component]!
  const used: string[] = []
  const seen = new Set<string>()
  const walk = (id: string, bound: ReadonlySet<string>) => {
    if (seen.has(id) || !has(spec.nodes, id)) return
    seen.add(id)
    const node = spec.nodes[id]!
    for (const name of namesUsedBy(node, library))
      if (!bound.has(name) && !used.includes(name)) used.push(name)
    // The engine only renders the children of nodes that take them, and of
    // those only the ones childProblem allows (a shape's animation nodes).
    if (!takesChildren(NODE_TYPES[node.type])) return
    const inner = new Set([...bound, ...bindsForChildren(node)])
    for (const child of node.children ?? []) {
      const childNode = has(spec.nodes, child) ? spec.nodes[child] : undefined
      if (childNode && childProblem(node.type, childNode.type)) continue
      walk(child, inner)
    }
  }
  walk(nodeId, new Set())

  const frames = scopeFrames(spec, component, nodeId) ?? []
  const inputs: Record<string, InputDecl> = {}
  const fromComponent: string[] = []
  for (const name of used) {
    const frame = frames.find((f) => f.vars.some((v) => v.name === name))
    if (!frame) continue
    if (frame.kind === 'inputs') {
      inputs[name] = { type: spec.inputs?.[name]?.type ?? 'any' }
      fromComponent.push(name)
    } else inputs[name] = { type: 'any' }
  }
  return { inputs, fromComponent }
}

/** How the instance binds an input to the variable of the same name. */
function binding(name: string, decl: InputDecl): ParamValue {
  // String bindings are literal text unless they start with `=`.
  return decl.type === 'string' ? `=${name}` : name
}

/**
 * The new definition (without its id) and the containing component with the
 * subtree replaced by one instance of it, `ref`. The instance reuses the
 * node's id, so its place among its parent's children (or its being loose)
 * and its saved position stay. The definition keeps the subtree's node ids,
 * params, expose, children and saved positions unchanged.
 */
export function collapseSubtree(
  spec: ComponentSpec,
  nodeId: string,
  ref: string,
  inputs: Readonly<Record<string, InputDecl>>,
): { parent: ComponentSpec; definition: Omit<ComponentSpec, 'id'> } {
  const ids = subtreeOf(spec, nodeId)
  const inside = new Set(ids)
  const below = new Set(ids.filter((id) => id !== nodeId))
  const pick = <T>(
    record: Readonly<Record<string, T>>,
    keep: (id: string) => boolean,
  ) => Object.fromEntries(Object.entries(record).filter(([id]) => keep(id)))

  const positions = pick(spec.editor ?? {}, (id) => inside.has(id))
  const definition: Omit<ComponentSpec, 'id'> = {
    format: SPEC_FORMAT,
    inputs: { ...inputs },
    root: nodeId,
    nodes: pick(spec.nodes, (id) => inside.has(id)),
    ...(Object.keys(positions).length > 0 && { editor: positions }),
  }

  const params = Object.fromEntries(
    Object.entries(inputs).map(([name, decl]) => [name, binding(name, decl)]),
  )
  const instance: NodeSpec = {
    type: 'component',
    ref,
    ...(Object.keys(params).length > 0 && { params }),
  }
  const parent: ComponentSpec = {
    ...spec,
    nodes: {
      ...pick(spec.nodes, (id) => !below.has(id)),
      [nodeId]: instance,
    },
    ...(spec.editor && {
      editor: pick(spec.editor, (id) => !below.has(id)),
    }),
  }
  return { parent, definition }
}

/**
 * The new definition's sample data: for each new input that is an input of
 * the containing component, its value in that component's sample if the
 * sample has it, else its declared default. Loop variables get nothing.
 * Undefined when no input gets a value (then no sample file is written).
 */
export function collapseSample(
  spec: ComponentSpec,
  sample: Readonly<Record<string, unknown>> | undefined,
  fromComponent: readonly string[],
): Record<string, unknown> | undefined {
  const data: Record<string, unknown> = {}
  for (const name of fromComponent) {
    if (has(sample, name)) data[name] = sample![name]
    else {
      const decl = spec.inputs?.[name]
      if (decl && 'default' in decl) data[name] = decl.default
    }
  }
  return Object.keys(data).length > 0 ? data : undefined
}

const MAX_NAME = 64

/**
 * The name the dialog suggests for the new component: `<component>-part`,
 * then `-part-2`, `-part-3` when taken. A long component name is cut so the
 * suggestion stays within the 64 characters a name may have.
 */
export function collapseName(
  library: Readonly<Record<string, unknown>>,
  component: string,
): string {
  const named = (suffix: string) =>
    `${component.slice(0, MAX_NAME - '-part'.length - suffix.length)}-part${suffix}`
  if (!Object.hasOwn(library, named(''))) return named('')
  for (let n = 2; ; n++) {
    const name = named(`-${n}`)
    if (!Object.hasOwn(library, name)) return name
  }
}

/** Everything a collapse changes, worked out from the library. */
export interface Collapse {
  /** The containing component with the instance in place of the subtree. */
  parent: ComponentSpec
  /** The new definition, with `id`. */
  definition: ComponentSpec
  /** Its sample data, or undefined for none. */
  sample: Record<string, unknown> | undefined
}

/**
 * Collapse `nodeId` in `component` into a new definition with id `id`.
 * Undefined when `collapseProblem` refuses the node. Positions are copied as
 * saved, so freeze the containing component's layout first.
 */
export function planCollapse(
  library: Library,
  component: string,
  nodeId: string,
  id: string,
  sample?: Readonly<Record<string, unknown>>,
): Collapse | undefined {
  const spec = has(library, component) ? library[component]! : undefined
  if (!spec || collapseProblem(spec, nodeId) !== undefined) return undefined
  const { inputs, fromComponent } = collapseInputs(library, component, nodeId)
  const { parent, definition } = collapseSubtree(spec, nodeId, id, inputs)
  return {
    parent,
    // `id` second, as in every spec file.
    definition: (({ format, ...rest }) => ({ format, id, ...rest }))(
      definition,
    ),
    sample: collapseSample(spec, sample, fromComponent),
  }
}
