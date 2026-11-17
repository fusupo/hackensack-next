import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { compile, SPEC_FORMAT } from '../engine/index.ts'
import { DataPane } from './DataPane.tsx'
import { problemsByNode } from './diagnostics.ts'
import { EXAMPLE_PROJECTS } from './examples.ts'
import { GraphView } from './GraphView.tsx'
import { PreviewPane } from './PreviewPane.tsx'
import { sampleFor } from './projects.ts'
import type { Project, SampleData } from './projects.ts'

// M2: a read-only editor. Pick an example project and component, see its
// graph, and edit the sample data to watch the preview update live.

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

/** The component a project opens on: the one named after the project, else the first. */
function defaultComponent(project: Project): string {
  const names = Object.keys(project.library)
  return names.includes(project.name) ? project.name : (names[0] ?? '')
}

interface Selection {
  project: Project
  component: string
  /** The data being rendered: the last text that parsed as a JSON object. */
  data: SampleData
  text: string
  textError: string | undefined
}

function select(project: Project, component: string): Selection {
  const data = sampleFor(project, component)
  return {
    project,
    component,
    data,
    text: JSON.stringify(data, null, 2),
    textError: undefined,
  }
}

export default function App() {
  const first = EXAMPLE_PROJECTS[0]
  if (!first)
    return <p className="placeholder">No projects found in examples/.</p>
  return <Editor initial={first} />
}

function Editor({ initial }: { initial: Project }) {
  const [selection, setSelection] = useState(() =>
    select(initial, defaultComponent(initial)),
  )
  const { project, component, data } = selection

  const program = useMemo(
    () => compile(component, project.library),
    [project, component],
  )
  const result = useMemo(() => program.render(data), [program, data])
  const problems = useMemo(
    () => [...program.errors, ...result.errors],
    [program, result],
  )

  const nodeProblems = useMemo(
    () => problemsByNode(problems, component),
    [problems, component],
  )

  const editText = (text: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      setSelection((s) => ({
        ...s,
        text,
        textError: `Not valid JSON: ${(e as Error).message}.`,
      }))
      return
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      setSelection((s) => ({
        ...s,
        text,
        textError: 'The data must be a JSON object, with one key per input.',
      }))
      return
    }
    setSelection((s) => ({
      ...s,
      text,
      textError: undefined,
      data: parsed as SampleData,
    }))
  }

  const spec = project.library[component]!

  return (
    <div className="shell">
      <header className="topbar" style={{ gridArea: 'top' }}>
        <h1>hackensack-next</h1>
        <label>
          Project
          <select
            value={project.name}
            onChange={(e) => {
              const next = EXAMPLE_PROJECTS.find(
                (p) => p.name === e.target.value,
              )!
              setSelection(select(next, defaultComponent(next)))
            }}
          >
            {EXAMPLE_PROJECTS.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>
          Component
          <select
            value={component}
            onChange={(e) => setSelection(select(project, e.target.value))}
          >
            {Object.keys(project.library).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <span className="format">{SPEC_FORMAT} · read-only</span>
      </header>

      <Pane title="Palette" area="palette">
        <p className="placeholder">
          Node types and the component library (M3, M4).
        </p>
      </Pane>

      <Pane title="Inspector" area="inspector">
        <p className="placeholder">
          Parameters and in-scope variables for the selected node (M3).
        </p>
      </Pane>

      <section
        className="pane graph"
        style={{ gridArea: 'graph' }}
        aria-label="Graph"
      >
        <GraphView
          key={`${project.name}/${component}`}
          spec={spec}
          problemsByNode={nodeProblems}
        />
      </section>

      <Pane title="Preview" area="preview">
        <PreviewPane output={result.output} problems={problems} />
      </Pane>

      <Pane title="Sample data" area="data">
        <DataPane
          inputs={spec.inputs ?? {}}
          text={selection.text}
          error={selection.textError}
          onChange={editText}
          onReset={() => setSelection(select(project, component))}
        />
      </Pane>
    </div>
  )
}
