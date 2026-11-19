// Editing a component spec. Pure functions: each returns a new spec (or the
// same object when nothing changes), so React state and undo stay simple.

import { NODE_TYPES } from '../engine/index.ts'
import type {
  ComponentSpec,
  InputDecl,
  NodeSpec,
  ParamKind,
  ParamValue,
} from '../engine/index.ts'

export interface Position {
  x: number
  y: number
}

const withNodes = (
  spec: ComponentSpec,
  nodes: Record<string, NodeSpec>,
): ComponentSpec => ({ ...spec, nodes })

function updateNode(
  spec: ComponentSpec,
  id: string,
  update: (node: NodeSpec) => NodeSpec,
): ComponentSpec {
  const node = spec.nodes[id]
  if (!node) return spec
  return withNodes(spec, { ...spec.nodes, [id]: update(node) })
}

/** The next free id of the form n<number>. */
export function nextNodeId(spec: ComponentSpec): string {
  let max = -1
  for (const id of Object.keys(spec.nodes)) {
    const match = /^n(\d+)$/.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  let n = max + 1
  while (`n${n}` in spec.nodes) n++
  return `n${n}`
}

/** Saved editor position of a node, if any. */
export function savedPosition(
  spec: ComponentSpec,
  id: string,
): Position | undefined {
  const value = spec.editor?.[id] as Partial<Position> | undefined
  return typeof value?.x === 'number' && typeof value.y === 'number'
    ? { x: value.x, y: value.y }
    : undefined
}

export function moveNodes(
  spec: ComponentSpec,
  positions: Readonly<Record<string, Position>>,
): ComponentSpec {
  const ids = Object.keys(positions).filter((id) => {
    if (!(id in spec.nodes)) return false
    const saved = savedPosition(spec, id)
    return saved?.x !== positions[id]!.x || saved?.y !== positions[id]!.y
  })
  // Nothing moved: the same spec, so a still drag records no edit.
  if (ids.length === 0) return spec
  return {
    ...spec,
    editor: {
      ...spec.editor,
      ...Object.fromEntries(ids.map((id) => [id, positions[id]])),
    },
  }
}

/**
 * Save a position for every node that doesn't have one, so that later edits
 * don't make the automatic layout move nodes the user has been looking at.
 */
export function freezeLayout(
  spec: ComponentSpec,
  layout: ReadonlyMap<string, Position>,
): ComponentSpec {
  const missing = Object.keys(spec.nodes).filter(
    (id) => !savedPosition(spec, id) && layout.has(id),
  )
  return missing.length === 0
    ? spec
    : moveNodes(
        spec,
        Object.fromEntries(missing.map((id) => [id, layout.get(id)!])),
      )
}

/** Add an unconnected node. Component instances get `ref`. */
export function addNode(
  spec: ComponentSpec,
  type: string,
  position: Position,
  ref?: string,
): { spec: ComponentSpec; id: string } {
  const id = nextNodeId(spec)
  const node: NodeSpec = { type, ...(ref !== undefined && { ref }) }
  return {
    id,
    spec: {
      ...withNodes(spec, { ...spec.nodes, [id]: node }),
      editor: { ...spec.editor, [id]: position },
    },
  }
}

/** The node that has `id` as a child, and where. */
export function parentOf(
  spec: ComponentSpec,
  id: string,
): { parent: string; index: number } | undefined {
  for (const [parent, node] of Object.entries(spec.nodes)) {
    const index = (node.children ?? []).indexOf(id)
    if (index !== -1) return { parent, index }
  }
  return undefined
}

/** Is `ancestor` above `id` in the tree (or the same node)? */
export function isAncestorOrSelf(
  spec: ComponentSpec,
  ancestor: string,
  id: string,
): boolean {
  const seen = new Set<string>()
  for (
    let current: string | undefined = id;
    current && !seen.has(current);
    current = parentOf(spec, current)?.parent
  ) {
    if (current === ancestor) return true
    seen.add(current)
  }
  return false
}

/** Why `child` can't be plugged into `parent`, or undefined if it can. */
export function connectProblem(
  spec: ComponentSpec,
  child: string,
  parent: string,
): string | undefined {
  const parentNode = spec.nodes[parent]
  if (!parentNode || !spec.nodes[child]) return 'unknown node'
  if (NODE_TYPES[parentNode.type]?.children !== 'many')
    return `a ${parentNode.type} node can't have children`
  if (child === spec.root) return "the root can't go inside another node"
  if (isAncestorOrSelf(spec, child, parent))
    return "a node can't go inside itself"
  return undefined
}

/**
 * Plug `child` into slot `slot` of `parent`, inserting before whatever is
 * there (slot = number of children appends). A child that already has a
 * parent is moved. Returns the spec unchanged if the connection isn't allowed.
 */
export function connect(
  spec: ComponentSpec,
  child: string,
  parent: string,
  slot: number,
): ComponentSpec {
  if (connectProblem(spec, child, parent)) return spec
  let target = slot
  let nodes = spec.nodes
  const current = parentOf(spec, child)
  if (current) {
    const siblings = [...(nodes[current.parent]!.children ?? [])]
    siblings.splice(current.index, 1)
    nodes = {
      ...nodes,
      [current.parent]: { ...nodes[current.parent]!, children: siblings },
    }
    if (current.parent === parent && current.index < slot) target--
  }
  const children = [...(nodes[parent]!.children ?? [])]
  children.splice(Math.max(0, Math.min(target, children.length)), 0, child)
  return withNodes(spec, {
    ...nodes,
    [parent]: { ...nodes[parent]!, children },
  })
}

/** Unplug the child in slot `index` of `parent`; it stays in the graph, unconnected. */
export function disconnect(
  spec: ComponentSpec,
  parent: string,
  index: number,
): ComponentSpec {
  return updateNode(spec, parent, (node) => {
    const children = [...(node.children ?? [])]
    if (index < 0 || index >= children.length) return node
    children.splice(index, 1)
    return { ...node, children }
  })
}

/**
 * Unplug `child` from `parent`, wherever it sits. Safer than an index when
 * several removals arrive together (indices shift as children are removed).
 */
export function disconnectChild(
  spec: ComponentSpec,
  parent: string,
  child: string,
): ComponentSpec {
  const index = (spec.nodes[parent]?.children ?? []).indexOf(child)
  return index === -1 ? spec : disconnect(spec, parent, index)
}

/** Delete nodes (never the root). Their children stay in the graph, unconnected. */
export function deleteNodes(
  spec: ComponentSpec,
  ids: readonly string[],
): ComponentSpec {
  const doomed = new Set(
    ids.filter((id) => id !== spec.root && id in spec.nodes),
  )
  if (doomed.size === 0) return spec
  const nodes: Record<string, NodeSpec> = {}
  for (const [id, node] of Object.entries(spec.nodes)) {
    if (doomed.has(id)) continue
    nodes[id] = node.children?.some((c) => doomed.has(c))
      ? { ...node, children: node.children.filter((c) => !doomed.has(c)) }
      : node
  }
  const editor = Object.fromEntries(
    Object.entries(spec.editor ?? {}).filter(([id]) => !doomed.has(id)),
  )
  return { ...withNodes(spec, nodes), editor }
}

/** Make `id` the root. It's unplugged from its parent; the old root stays as an unconnected node. */
export function setRoot(spec: ComponentSpec, id: string): ComponentSpec {
  if (!(id in spec.nodes) || id === spec.root) return spec
  const current = parentOf(spec, id)
  const unplugged = current
    ? disconnect(spec, current.parent, current.index)
    : spec
  return { ...unplugged, root: id }
}

/** Set a param (or remove it, with `undefined`). */
export function setParam(
  spec: ComponentSpec,
  id: string,
  name: string,
  value: ParamValue | undefined,
): ComponentSpec {
  return updateNode(spec, id, (node) => {
    const params = { ...node.params }
    if (value === undefined) delete params[name]
    else params[name] = value
    return { ...node, params }
  })
}

export function setRef(
  spec: ComponentSpec,
  id: string,
  ref: string,
): ComponentSpec {
  return updateNode(spec, id, (node) => ({ ...node, ref }))
}

/**
 * Read what was typed into a param field. Empty means "not set". Plain
 * numbers in number and length fields are stored as JSON numbers, which keeps
 * saved specs tidy; everything else is stored as typed.
 */
export function parseParamInput(
  kind: ParamKind,
  text: string,
): ParamValue | undefined {
  if (text.trim() === '') return undefined
  if (
    (kind === 'number' || kind === 'length') &&
    /^-?\d+(\.\d+)?$/.test(text.trim())
  )
    return Number(text)
  return text
}

/** Add, replace or (with `undefined`) remove an input declaration. */
export function setInput(
  spec: ComponentSpec,
  name: string,
  decl: InputDecl | undefined,
): ComponentSpec {
  const inputs = { ...spec.inputs }
  if (decl === undefined) delete inputs[name]
  else inputs[name] = decl
  return { ...spec, inputs }
}

/**
 * Rename an input, keeping its position in the list. Expressions that use the
 * old name aren't rewritten; the engine reports them.
 */
export function renameInput(
  spec: ComponentSpec,
  from: string,
  to: string,
): ComponentSpec {
  const inputs = spec.inputs ?? {}
  if (!(from in inputs) || to in inputs) return spec
  return {
    ...spec,
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([name, decl]) => [
        name === from ? to : name,
        decl,
      ]),
    ),
  }
}
