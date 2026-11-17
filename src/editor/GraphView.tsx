import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import type {
  Connection,
  Edge,
  IsValidConnection,
  OnEdgesChange,
  OnNodesChange,
} from '@xyflow/react'
import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import type { ComponentSpec } from '../engine/index.ts'
import { BloqNode } from './BloqNode.tsx'
import { connect, connectProblem, moveNodes } from './edit.ts'
import type { Position } from './edit.ts'
import { specToFlow } from './layout.ts'
import type { BloqFlowNode } from './layout.ts'

const nodeTypes = { bloq: BloqNode }

/** dataTransfer type for nodes dragged from the palette. */
export const PALETTE_DRAG_TYPE = 'application/x-hackensack-node'

export interface PaletteItem {
  type: string
  ref?: string
}

export interface GraphViewProps {
  spec: ComponentSpec
  problemsByNode: ReadonlyMap<string, readonly string[]>
  selected: string | undefined
  onSelect: (id: string | undefined) => void
  /** Apply an edit to the spec. */
  onEdit: (update: (spec: ComponentSpec) => ComponentSpec) => void
  onDelete: (ids: string[]) => void
  onDisconnect: (parent: string, child: string) => void
  onAdd: (item: PaletteItem, position: Position) => void
  /** Double-click on a component instance: open its definition. */
  onEnter: (instanceId: string) => void
}

/** Things React Flow tracks per node that the spec doesn't: size, and position mid-drag. */
interface Transient {
  measured?: { width?: number; height?: number }
  dragPosition?: Position
}

/** "parent:index" edge ids, as made by specToFlow. */
function edgeEnds(id: string): { parent: string; index: number } {
  const at = id.lastIndexOf(':')
  return { parent: id.slice(0, at), index: Number(id.slice(at + 1)) }
}

function Graph({
  spec,
  problemsByNode,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onDisconnect,
  onAdd,
  onEnter,
}: GraphViewProps) {
  const flow = useReactFlow()
  const derived = useMemo(
    () => specToFlow(spec, problemsByNode),
    [spec, problemsByNode],
  )
  const [transient, setTransient] = useState<Record<string, Transient>>({})
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(
    new Set(),
  )

  const nodes: BloqFlowNode[] = derived.nodes.map((node) => {
    const extra = transient[node.id]
    return {
      ...node,
      ...(extra?.measured && { measured: extra.measured }),
      position: extra?.dragPosition ?? node.position,
      selected: node.id === selected,
      deletable: node.id !== spec.root,
    }
  })
  const edges: Edge[] = derived.edges.map((edge) => ({
    ...edge,
    selected: selectedEdges.has(edge.id),
  }))

  const onNodesChange: OnNodesChange<BloqFlowNode> = (changes) => {
    const removed: string[] = []
    let selection: string | null | undefined // undefined: no selection change
    const updates: Record<string, Transient> = {}
    for (const change of changes) {
      if (change.type === 'dimensions' && change.dimensions) {
        updates[change.id] = {
          ...transient[change.id],
          ...updates[change.id],
          measured: change.dimensions,
        }
      } else if (change.type === 'position' && change.position) {
        updates[change.id] = {
          ...transient[change.id],
          ...updates[change.id],
          dragPosition: change.position,
        }
      } else if (change.type === 'select') {
        if (change.selected) selection = change.id
        else if (selection === undefined && change.id === selected)
          selection = null
      } else if (change.type === 'remove') {
        removed.push(change.id)
      }
    }
    if (Object.keys(updates).length > 0)
      setTransient((t) => ({ ...t, ...updates }))
    if (selection !== undefined) onSelect(selection ?? undefined)
    if (removed.length > 0) onDelete(removed)
  }

  const onEdgesChange: OnEdgesChange = (changes) => {
    const next = new Set(selectedEdges)
    for (const change of changes) {
      if (change.type === 'select') {
        if (change.selected) next.add(change.id)
        else next.delete(change.id)
      } else if (change.type === 'remove') {
        const edge = derived.edges.find((e) => e.id === change.id)
        if (edge) onDisconnect(edgeEnds(edge.id).parent, edge.source)
        next.delete(change.id)
      }
    }
    setSelectedEdges(next)
  }

  const isValidConnection: IsValidConnection = (c) =>
    connectProblem(spec, c.source, c.target) === undefined

  const onConnect = (c: Connection) => {
    const slot = Number(c.targetHandle?.replace('slot-', '') ?? 0)
    onEdit((s) => connect(s, c.source, c.target, slot))
  }

  const onDrop = (event: DragEvent) => {
    const raw = event.dataTransfer.getData(PALETTE_DRAG_TYPE)
    if (!raw) return
    event.preventDefault()
    const item = JSON.parse(raw) as PaletteItem
    onAdd(
      item,
      flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={(_event, _node, dragged) => {
        const moved = Object.fromEntries(dragged.map((n) => [n.id, n.position]))
        onEdit((s) => moveNodes(s, moved))
        setTransient((t) => {
          const next = { ...t }
          for (const id of Object.keys(moved))
            next[id] = { ...next[id], dragPosition: undefined }
          return next
        })
      }}
      onNodeDoubleClick={(_event, node) => {
        if (node.data.type === 'component') onEnter(node.id)
      }}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={onDrop}
      nodeTypes={nodeTypes}
      deleteKeyCode={['Backspace', 'Delete']}
      fitView
      fitViewOptions={{ padding: '40px' }}
      minZoom={0.2}
    >
      <Background />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  )
}

/**
 * The component's node graph, editable. Wires mean nesting: drag from a
 * node's output (right) to a slot on its parent (left). Double-click a
 * component instance to enter its definition. Remount it (via `key`) to show a
 * different component.
 */
export function GraphView(props: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  )
}
