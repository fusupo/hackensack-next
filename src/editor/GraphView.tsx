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
import type { ComponentSpec } from '@hackensack/engine'
import { FindNode } from './FindNode.tsx'
import { BloqNode } from './BloqNode.tsx'
import { connect, connectProblem, moveNodes } from './edit.ts'
import type { Position, Wire } from './edit.ts'
import { specToFlow } from './layout.ts'
import type { BloqFlowNode } from './layout.ts'
import type { Usage } from './usage.ts'

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
  /** Where each component is used, for the badges on instance nodes. */
  usage: Usage
  /** Definition names by id (usage.ts `namesById`), to label instances. */
  names: ReadonlyMap<string, string>
  selected: string | undefined
  onSelect: (id: string | undefined) => void
  /** Apply an edit to the spec. */
  onEdit: (update: (spec: ComponentSpec) => ComponentSpec) => void
  /** Remove nodes and wires, as one edit (the Delete key removes both at once). */
  onRemove: (nodeIds: string[], wires: Wire[]) => void
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
  usage,
  names,
  selected,
  onSelect,
  onEdit,
  onRemove,
  onAdd,
  onEnter,
}: GraphViewProps) {
  const flow = useReactFlow()
  const derived = useMemo(
    () => specToFlow(spec, problemsByNode, usage, names),
    [spec, problemsByNode, usage, names],
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
      }
      // 'remove' changes are handled once, in onDelete.
    }
    if (Object.keys(updates).length > 0)
      setTransient((t) => ({ ...t, ...updates }))
    if (selection !== undefined) onSelect(selection ?? undefined)
  }

  const onEdgesChange: OnEdgesChange = (changes) => {
    const next = new Set(selectedEdges)
    for (const change of changes) {
      if (change.type === 'select') {
        if (change.selected) next.add(change.id)
        else next.delete(change.id)
      } else if (change.type === 'remove') {
        // The edit itself happens once, in onDelete.
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

  /** Find node (#59): centre the picked node in the view, then select it. */
  const bringIntoView = (id: string) => {
    const node = flow.getNode(id)
    if (node) {
      const width = node.measured?.width ?? 0
      const height = node.measured?.height ?? 0
      // No animation, so the node is in place as soon as it is selected.
      void flow.setCenter(
        node.position.x + width / 2,
        node.position.y + height / 2,
        { zoom: Math.max(flow.getZoom(), 0.8), duration: 0 },
      )
    }
    onSelect(id)
  }

  return (
    <div className="graph-view">
      <FindNode spec={spec} names={names} onPick={bringIntoView} />
      <div className="graph-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={(_event, _node, dragged) => {
            const moved = Object.fromEntries(
              dragged.map((n) => [n.id, n.position]),
            )
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
          onDelete={({ nodes: gone, edges: cut }) => {
            // The deleted nodes and every wire attached to them, as one edit.
            const wires = cut.map((edge) => ({
              parent: edgeEnds(edge.id).parent,
              child: edge.source,
            }))
            if (gone.length > 0 || wires.length > 0)
              onRemove(
                gone.map((n) => n.id),
                wires,
              )
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
      </div>
    </div>
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
