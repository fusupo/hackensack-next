import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
} from '@xyflow/react'
import { useEffect, useState } from 'react'
import type { ComponentSpec } from '../engine/index.ts'
import { BloqNode } from './BloqNode.tsx'
import { specToFlow } from './layout.ts'

const nodeTypes = { bloq: BloqNode }

/**
 * The component's node graph. Read-only in M2: nodes can be moved around to
 * look at them (not saved), but not connected, edited or deleted.
 * Remount it (via `key`) to show a different component.
 */
export function GraphView({
  spec,
  problemsByNode,
}: {
  spec: ComponentSpec
  problemsByNode: ReadonlyMap<string, readonly string[]>
}) {
  // Layout is computed once per mount (the parent remounts this per spec);
  // later problem updates only touch node data, keeping positions.
  const [initial] = useState(() => specToFlow(spec, problemsByNode))
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          problems: [...(problemsByNode.get(node.id) ?? [])],
        },
      })),
    )
  }, [problemsByNode, setNodes])

  return (
    <ReactFlow
      nodes={nodes}
      edges={initial.edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      nodesConnectable={false}
      deleteKeyCode={null}
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
