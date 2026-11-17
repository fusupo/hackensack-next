// Turn a component spec into React Flow nodes and edges.
//
// Wires mean nesting (PLAN.md, "Decisions made"): a node's output plugs into
// one of its parent's ordered child slots. The root sits on the right and the
// tree grows to the left, so the picture "flows" towards the root, like the
// output node in Blender. Positions come from the spec's `editor` section when
// present; otherwise a simple tidy-tree layout places them.

import type { Edge, Node } from '@xyflow/react'
import { NODE_TYPES } from '../engine/index.ts'
import type { ComponentSpec, ParamValue } from '../engine/index.ts'

export interface BloqData extends Record<string, unknown> {
  id: string
  type: string
  /** Component instances: the definition they use. */
  ref?: string
  params: { name: string; value: string }[]
  /** Number of child slots (input handles) on the left. */
  slots: number
  /** The root has no output handle: its output is the picture. */
  isRoot: boolean
  problems: string[]
}

export type BloqFlowNode = Node<BloqData, 'bloq'>

export const NODE_WIDTH = 230
const COLUMN_WIDTH = 300
const ROW_GAP = 28
export const SLOT_TOP = 44
export const SLOT_SPACING = 22
export const MAX_PARAM_LINES = 5

/** Height of a node card. BloqNode renders at exactly this height. */
export function nodeHeight(
  data: Pick<BloqData, 'params' | 'slots' | 'ref'>,
): number {
  const lines =
    Math.min(data.params.length, MAX_PARAM_LINES) +
    (data.params.length > MAX_PARAM_LINES ? 1 : 0) +
    (data.ref ? 1 : 0)
  const forContent = 40 + lines * 18 + 10
  const forSlots = SLOT_TOP + data.slots * SLOT_SPACING
  return Math.max(forContent, forSlots, 56)
}

/** Vertical centre of child slot `index`, from the top of the node. */
export function slotY(index: number): number {
  return SLOT_TOP + index * SLOT_SPACING + SLOT_SPACING / 2
}

export function specToFlow(
  spec: ComponentSpec,
  problemsByNode: ReadonlyMap<string, readonly string[]> = new Map(),
): { nodes: BloqFlowNode[]; edges: Edge[] } {
  const nodes = spec.nodes ?? {}
  const childrenOf = (id: string) =>
    (nodes[id]?.children ?? []).filter((c) => c in nodes)

  const data = new Map<string, BloqData>()
  for (const [id, node] of Object.entries(nodes)) {
    const def = NODE_TYPES[node.type]
    data.set(id, {
      id,
      type: node.type,
      ...(node.ref !== undefined && { ref: node.ref }),
      params: Object.entries(node.params ?? {}).map(([name, value]) => ({
        name,
        value: showValue(value),
      })),
      slots: def?.children === 'none' ? 0 : (node.children ?? []).length,
      isRoot: id === spec.root,
      problems: [...(problemsByNode.get(id) ?? [])],
    })
  }

  // Tidy tree: leaves are stacked top to bottom in child order; each parent is
  // centred on its children, one column to the right.
  const positions = new Map<string, { x: number; y: number }>()
  let cursor = 0
  const place = (
    id: string,
    depth: number,
  ): { top: number; bottom: number } => {
    const height = nodeHeight(data.get(id)!)
    const kids = childrenOf(id).filter((c) => !positions.has(c) && c !== id)
    positions.set(id, { x: 0, y: 0 }) // reserve, so a node used twice is placed once
    let y: number
    let top: number
    let bottom: number
    if (kids.length === 0) {
      y = cursor
      top = y
      bottom = y + height
    } else {
      const spans = kids.map((kid) => place(kid, depth + 1))
      top = spans[0]!.top
      bottom = spans[spans.length - 1]!.bottom
      y = (top + bottom) / 2 - height / 2
      top = Math.min(top, y)
      bottom = Math.max(bottom, y + height)
    }
    cursor = Math.max(cursor, y + height + ROW_GAP)
    positions.set(id, { x: depth === 0 ? 0 : -depth * COLUMN_WIDTH, y })
    return { top, bottom }
  }

  // The root's tree first, then any nodes that aren't connected to it.
  const referenced = new Set(
    Object.values(nodes).flatMap((n) => n.children ?? []),
  )
  const starts = [
    ...(spec.root in nodes ? [spec.root] : []),
    ...Object.keys(nodes).filter(
      (id) => id !== spec.root && !referenced.has(id),
    ),
  ]
  for (const id of starts) if (!positions.has(id)) place(id, 0)
  for (const id of Object.keys(nodes)) if (!positions.has(id)) place(id, 0) // cycles of children

  const saved = spec.editor ?? {}
  const flowNodes: BloqFlowNode[] = Object.keys(nodes).map((id) => {
    const fromSpec = saved[id] as { x?: unknown; y?: unknown } | undefined
    const position =
      typeof fromSpec?.x === 'number' && typeof fromSpec.y === 'number'
        ? { x: fromSpec.x, y: fromSpec.y }
        : positions.get(id)!
    return { id, type: 'bloq', position, data: data.get(id)! }
  })

  const edges: Edge[] = Object.entries(nodes).flatMap(([parent, node]) =>
    (node.children ?? []).flatMap((child, index) =>
      child in nodes
        ? [
            {
              id: `${parent}:${index}`,
              source: child,
              sourceHandle: 'out',
              target: parent,
              targetHandle: `slot-${index}`,
            },
          ]
        : [],
    ),
  )

  return { nodes: flowNodes, edges }
}

/** How a param value is shown on a node card. */
export function showValue(value: ParamValue): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 32 ? `${text.slice(0, 31)}…` : text
}
