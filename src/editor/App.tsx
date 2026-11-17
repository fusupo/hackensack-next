import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react'
import type { ReactNode } from 'react'
import { SPEC_FORMAT } from '../engine/index.ts'

// Empty editor shell (M0). Each pane says which milestone fills it in;
// see PLAN.md, "Milestones".

function Pane({
  title,
  area,
  children,
}: {
  title: string
  area: string
  children?: ReactNode
}) {
  return (
    <section className="pane" style={{ gridArea: area }} aria-label={title}>
      <h2 className="pane-title">{title}</h2>
      <div className="pane-body">{children}</div>
    </section>
  )
}

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="placeholder">{children}</p>
}

export default function App() {
  return (
    <div className="shell">
      <header className="topbar" style={{ gridArea: 'top' }}>
        <h1>hackensack-next</h1>
        <span className="format">{SPEC_FORMAT}</span>
      </header>

      <Pane title="Palette" area="palette">
        <Placeholder>
          Node types and the component library (M3, M4).
        </Placeholder>
      </Pane>

      <section
        className="pane graph"
        style={{ gridArea: 'graph' }}
        aria-label="Graph"
      >
        <ReactFlow nodes={[]} edges={[]} fitView>
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </section>

      <Pane title="Inspector" area="inspector">
        <Placeholder>
          Parameters and in-scope variables for the selected node (M3).
        </Placeholder>
      </Pane>

      <Pane title="Preview" area="preview">
        <Placeholder>The rendered picture (M2).</Placeholder>
      </Pane>

      <Pane title="Sample data" area="data">
        <Placeholder>Inputs to render the picture with (M2).</Placeholder>
      </Pane>
    </div>
  )
}
