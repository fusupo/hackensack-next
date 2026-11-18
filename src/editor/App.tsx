import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { compile, SPEC_FORMAT } from '../engine/index.ts'
import type { ComponentSpec } from '../engine/index.ts'
import { loadWorkspace, saveFiles } from './api.ts'
import type { Workspace } from './api.ts'
import { Breadcrumbs } from './Breadcrumbs.tsx'
import { DataPane } from './DataPane.tsx'
import { problemsAt, problemsByNode } from './diagnostics.ts'
import {
  addNode,
  deleteNodes,
  disconnectChild,
  freezeLayout,
  nextNodeId,
  savedPosition,
} from './edit.ts'
import type { Position } from './edit.ts'
import { GraphView } from './GraphView.tsx'
import type { PaletteItem } from './GraphView.tsx'
import { Inspector } from './Inspector.tsx'
import { autoLayout } from './layout.ts'
import { Palette } from './Palette.tsx'
import { PreviewPane } from './PreviewPane.tsx'
import {
  addComponent,
  duplicateProject,
  fileContent,
  markSaved,
  NAME,
  newProject,
  projectKey,
  sampleFor,
  setSample,
  updateComponent,
  withMissingInputs,
} from './projects.ts'
import type { Project, SampleData } from './projects.ts'
import {
  currentOf,
  enterComponent,
  exitTo,
  openTrail,
  settleTrail,
  topOf,
} from './trail.ts'
import type { Trail } from './trail.ts'
import { namesById, usageOf, usageCount } from './usage.ts'

// M3: the authoring editor. Projects come from the dev server's file store
// (server/plugin.ts): examples are read-only, your projects are saved under
// projects/. Without a dev server it falls back to the bundled examples and
// can't save.

function Pane({
  title,
  area,
  className,
  children,
}: {
  title: string
  area?: string
  className?: string
  children?: ReactNode
}) {
  return (
    <section
      className={`pane${className ? ` ${className}` : ''}`}
      style={area ? { gridArea: area } : undefined}
      aria-label={title}
    >
      <h2 className="pane-title">{title}</h2>
      <div className="pane-body">{children}</div>
    </section>
  )
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>()
  useEffect(() => {
    void loadWorkspace().then(setWorkspace)
  }, [])
  if (!workspace) return <p className="loading">Loading projects…</p>
  return (
    <Editor
      workspace={workspace}
      setWorkspace={(update) => setWorkspace((w) => (w ? update(w) : w))}
    />
  )
}

/** The component a project opens on: the one named after the project, else the first. */
function defaultComponent(project: Project): string {
  const names = Object.keys(project.library)
  return names.includes(project.name) ? project.name : (names[0] ?? '')
}

function askName(
  what: string,
  taken: (name: string) => boolean,
  suggestion = '',
): string | undefined {
  const name = window
    .prompt(`Name for the new ${what} (letters, digits, - and _):`, suggestion)
    ?.trim()
  if (!name) return undefined
  if (!NAME.test(name)) {
    window.alert(
      `"${name}" isn't a valid name. Use letters, digits, - and _, starting with a letter or digit.`,
    )
    return undefined
  }
  if (taken(name)) {
    window.alert(`There is already a ${what} named "${name}".`)
    return undefined
  }
  return name
}

/** Somewhere free to put a node added by clicking the palette: left of everything. */
function freeSpot(spec: ComponentSpec): Position {
  const layout = autoLayout(spec)
  const positions = Object.keys(spec.nodes).map(
    (id) => savedPosition(spec, id) ?? layout.get(id) ?? { x: 0, y: 0 },
  )
  if (positions.length === 0) return { x: 0, y: 0 }
  return {
    x: Math.min(...positions.map((p) => p.x)) - 300,
    y: Math.min(...positions.map((p) => p.y)),
  }
}

function Editor({
  workspace,
  setWorkspace,
}: {
  workspace: Workspace
  setWorkspace: (update: (w: Workspace) => Workspace) => void
}) {
  const [current, setCurrent] = useState<{ key: string; trail: Trail }>(() => {
    const first = workspace.projects[0]
    return {
      key: first ? projectKey(first) : '',
      trail: openTrail(first ? defaultComponent(first) : ''),
    }
  })
  const [selected, setSelected] = useState<string>()
  const [status, setStatus] = useState<{ error: boolean; text: string }>()

  const project = workspace.projects.find((p) => projectKey(p) === current.key)
  // The breadcrumb trail of entered components. The last crumb is the one
  // being edited (graph, inspector, palette); the first is the picture being
  // compiled and previewed, with its sample data.
  const library = project?.library
  const trail = useMemo(
    // Cut the trail where it no longer holds (a component was deleted or an
    // instance repointed). If even the first crumb's component was deleted,
    // fall back to the project's default component.
    () => (project ? settleTrail(current.trail, project) : current.trail),
    [current.trail, project],
  )
  const component = currentOf(trail)
  const top = topOf(trail)
  const spec = project?.library[component]
  const topSpec = project?.library[top]
  /** Components that can't be used here: adding one would make a cycle. */
  const onTrail = trail.map((c) => c.component)
  /** Where each component is used, unsaved edits included. */
  const usage = useMemo(() => usageOf(library ?? {}), [library])
  /** Definition names by id, to label instances (their refs are ids). */
  const names = useMemo(() => namesById(library ?? {}), [library])

  const updateProject = (key: string, update: (p: Project) => Project) =>
    setWorkspace((w) => ({
      ...w,
      projects: w.projects.map((p) => (projectKey(p) === key ? update(p) : p)),
    }))

  /** Apply an edit to the current component. Freezes the automatic layout first, so nothing jumps. */
  const onEdit = (update: (spec: ComponentSpec) => ComponentSpec) =>
    updateProject(current.key, (p) =>
      updateComponent(p, component, (s) => {
        const frozen = freezeLayout(s, autoLayout(s))
        const next = update(frozen)
        return next === frozen ? s : next
      }),
    )

  const open = (next: Project, name = defaultComponent(next)) => {
    setCurrent({ key: projectKey(next), trail: openTrail(name) })
    setSelected(undefined)
    setStatus(undefined)
  }

  /** Follow the trail somewhere else: into an instance's definition, or back out. */
  const navigate = (next: Trail) => {
    setCurrent((c) => ({ ...c, trail: next }))
    setSelected(undefined)
    if (status?.error) setStatus(undefined)
  }
  const enter = (instanceId: string) => {
    if (!project) return
    const entered = enterComponent(trail, project.library, instanceId)
    if ('error' in entered) setStatus({ error: true, text: entered.error })
    else navigate(entered.trail)
  }

  // ---- data ----
  const samples = project?.samples
  /** The previewed picture's data. */
  const sample = useMemo(
    () => (library && samples ? sampleFor({ library, samples }, top) : {}),
    [library, samples, top],
  )
  /** The edited component's own data, for its scope panel. */
  const componentSample = useMemo(
    () =>
      library && samples ? sampleFor({ library, samples }, component) : {},
    [library, samples, component],
  )
  const dataKey = `${current.key}/${top}`
  const [dataText, setDataText] = useState({
    key: '',
    text: '',
    error: undefined as string | undefined,
  })
  if (dataText.key !== dataKey)
    setDataText({
      key: dataKey,
      text: JSON.stringify(sample, null, 2),
      error: undefined,
    })

  const editText = (text: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      setDataText({
        key: dataKey,
        text,
        error: `Not valid JSON: ${(e as Error).message}.`,
      })
      return
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      setDataText({
        key: dataKey,
        text,
        error: 'The data must be a JSON object, with one key per input.',
      })
      return
    }
    setDataText({ key: dataKey, text, error: undefined })
    updateProject(current.key, (p) => setSample(p, top, parsed as SampleData))
  }

  // ---- render ----
  // Recompiles only when the library changes, not when sample data does.
  const program = useMemo(
    () => (library?.[top] ? compile(top, library) : undefined),
    [library, top],
  )
  const result = useMemo(() => program?.render(sample), [program, sample])
  const problems = useMemo(
    () => [...(program?.errors ?? []), ...(result?.errors ?? [])],
    [program, result],
  )
  // Problems as seen from the edited component (render problems are reported
  // from the top of the trail).
  const scopedProblems = useMemo(
    () => problemsAt(problems, trail),
    [problems, trail],
  )
  const nodeProblems = useMemo(
    () => problemsByNode(scopedProblems, component),
    [scopedProblems, component],
  )

  // ---- saving ----
  const saving = useRef(false)
  const save = async () => {
    if (
      !project ||
      project.readOnly ||
      !workspace.canSave ||
      project.unsaved.length === 0 ||
      saving.current
    )
      return
    saving.current = true
    const snapshot = project
    try {
      const saved = await saveFiles(snapshot, snapshot.unsaved)
      // Only clear files that weren't edited again while saving.
      updateProject(projectKey(snapshot), (p) =>
        markSaved(
          p,
          saved.filter((f) => fileContent(p, f) === fileContent(snapshot, f)),
        ),
      )
      setStatus({
        error: false,
        text: `Saved ${saved.length} ${saved.length === 1 ? 'file' : 'files'}`,
      })
    } catch (e) {
      setStatus({ error: true, text: (e as Error).message })
    } finally {
      saving.current = false
    }
  }
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const anyUnsaved = workspace.projects.some((p) => p.unsaved.length > 0)
  useEffect(() => {
    if (!anyUnsaved) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [anyUnsaved])

  // ---- project and component actions ----
  const writable = workspace.projects.filter((p) => !p.readOnly)
  const createProject = () => {
    const name = askName('project', (n) => writable.some((p) => p.name === n))
    if (!name) return
    const created = newProject('projects', name)
    setWorkspace((w) => ({ ...w, projects: [created, ...w.projects] }))
    open(created)
  }
  const duplicate = () => {
    if (!project) return
    const name = askName(
      'project',
      (n) => writable.some((p) => p.name === n),
      project.name,
    )
    if (!name) return
    const copy = duplicateProject(project, 'projects', name)
    setWorkspace((w) => ({ ...w, projects: [copy, ...w.projects] }))
    // Same component names in the copy, so stay where you were.
    setCurrent({ key: projectKey(copy), trail })
    setSelected(undefined)
    setStatus({
      error: false,
      text: `Copied to projects/${name}. Save to write it to disk.`,
    })
  }
  const createComponent = () => {
    if (!project) return
    const name = askName('component', (n) => n in project.library)
    if (!name) return
    updateProject(current.key, (p) => addComponent(p, name))
    setCurrent((c) => ({ ...c, trail: openTrail(name) }))
    setSelected(undefined)
  }

  // ---- graph actions ----
  const addFromPalette = (item: PaletteItem, position?: Position) => {
    if (!spec) return
    const id = nextNodeId(spec)
    onEdit((s) => addNode(s, item.type, position ?? freeSpot(s), item.ref).spec)
    setSelected(id)
  }
  const deleteSelected = (ids: string[]) => {
    onEdit((s) => deleteNodes(s, ids))
    if (selected && ids.includes(selected)) setSelected(undefined)
  }
  const fillMissing = (() => {
    if (!topSpec) return undefined
    const filled = withMissingInputs(sample, topSpec.inputs ?? {})
    if (!filled) return undefined
    return () => {
      setDataText({
        key: dataKey,
        text: JSON.stringify(filled, null, 2),
        error: undefined,
      })
      updateProject(current.key, (p) => setSample(p, top, filled))
    }
  })()

  const projectOptions = (readOnly: boolean) =>
    workspace.projects
      .filter((p) => p.readOnly === readOnly)
      .map((p) => (
        <option key={projectKey(p)} value={projectKey(p)}>
          {p.name}
          {p.unsaved.length > 0 ? ' •' : ''}
        </option>
      ))

  return (
    <div className="shell">
      <header className="topbar" style={{ gridArea: 'top' }}>
        <h1>hackensack-next</h1>
        <label>
          Project
          <select
            value={current.key}
            onChange={(e) => {
              const next = workspace.projects.find(
                (p) => projectKey(p) === e.target.value,
              )
              if (next) open(next)
            }}
          >
            {writable.length > 0 && (
              <optgroup label="Your projects">{projectOptions(false)}</optgroup>
            )}
            <optgroup label="Examples (read-only)">
              {projectOptions(true)}
            </optgroup>
          </select>
        </label>
        {project && (
          <label>
            Component
            <select
              value={component}
              onChange={(e) => {
                // Picking a component directly starts a fresh trail.
                setCurrent((c) => ({ ...c, trail: openTrail(e.target.value) }))
                setSelected(undefined)
              }}
            >
              {Object.keys(project.library).map((name) => (
                <option key={name} value={name}>
                  {name}
                  {usage.has(name) ? ` (${usageCount(usage, name)})` : ''}
                  {project.unsaved.includes(`components/${name}`) ? ' •' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="topbar-actions">
          {project && !project.readOnly && (
            <button type="button" onClick={createComponent}>
              New component
            </button>
          )}
          {workspace.canSave && (
            <button type="button" onClick={createProject}>
              New project
            </button>
          )}
          {project?.readOnly && workspace.canSave && (
            <button
              type="button"
              onClick={duplicate}
              title="Examples are read-only. Copy this one into projects/ to change and save it."
            >
              Duplicate to edit…
            </button>
          )}
          {project && !project.readOnly && workspace.canSave && (
            <button
              type="button"
              className="primary"
              disabled={project.unsaved.length === 0}
              onClick={() => void save()}
              title="Save changed files (Ctrl+S)"
            >
              {project.unsaved.length > 0
                ? `Save (${project.unsaved.length})`
                : 'Saved'}
            </button>
          )}
        </div>
        <span
          className={`status${status?.error ? ' error' : ''}`}
          role="status"
        >
          {status?.text ??
            (!workspace.canSave
              ? 'No dev server: read-only'
              : project?.readOnly
                ? 'Example: changes are not saved'
                : SPEC_FORMAT)}
        </span>
      </header>

      <div className="side" style={{ gridArea: 'side' }}>
        <Pane title="Palette" className="palette-pane">
          {project && spec ? (
            <Palette
              components={Object.entries(project.library)
                .filter(([name]) => !onTrail.includes(name))
                .map(([name, s]) => ({ name, id: s.id }))}
              usage={usage}
              nested={trail.length > 1}
              onAdd={(item) => addFromPalette(item)}
            />
          ) : null}
        </Pane>
        <Pane title="Inspector" className="inspector-pane">
          {project && spec ? (
            <Inspector
              spec={spec}
              component={component}
              library={project.library}
              exclude={onTrail}
              usage={usage}
              selected={selected}
              problems={scopedProblems}
              sample={componentSample}
              onEdit={onEdit}
              onDelete={(id) => deleteSelected([id])}
            />
          ) : null}
        </Pane>
      </div>

      <section
        className="pane graph"
        style={{ gridArea: 'graph' }}
        aria-label="Graph"
      >
        {project && spec ? (
          <>
            <Breadcrumbs
              trail={trail}
              uses={usageCount(usage, component)}
              onNavigate={(index) => navigate(exitTo(trail, index))}
            />
            <div className="graph-canvas">
              <GraphView
                key={`${current.key}/${component}`}
                spec={spec}
                problemsByNode={nodeProblems}
                usage={usage}
                names={names}
                selected={selected}
                onSelect={setSelected}
                onEdit={onEdit}
                onDelete={deleteSelected}
                onDisconnect={(parent, child) =>
                  onEdit((s) => disconnectChild(s, parent, child))
                }
                onAdd={addFromPalette}
                onEnter={enter}
              />
            </div>
          </>
        ) : (
          <div className="empty">
            <p>No projects yet.</p>
            {workspace.canSave && (
              <button type="button" className="primary" onClick={createProject}>
                New project
              </button>
            )}
          </div>
        )}
      </section>

      <Pane
        title={trail.length > 1 ? `Preview · ${top}` : 'Preview'}
        area="preview"
      >
        <PreviewPane output={result?.output ?? []} problems={problems} />
      </Pane>

      <Pane
        title={trail.length > 1 ? `Sample data · ${top}` : 'Sample data'}
        area="data"
      >
        {topSpec && (
          <DataPane
            inputs={topSpec.inputs ?? {}}
            text={dataText.text}
            error={dataText.error}
            onChange={editText}
            onFillMissing={fillMissing}
          />
        )}
      </Pane>
    </div>
  )
}
