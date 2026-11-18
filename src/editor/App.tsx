import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { compile, SPEC_FORMAT } from '../engine/index.ts'
import type { ComponentSpec } from '../engine/index.ts'
import {
  commitProject,
  CommitError,
  deleteProjectOnDisk,
  loadWorkspace,
  renameProjectOnDisk,
} from './api.ts'
import type { Committed } from './commit.ts'
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
import { enteredChain, markEntered } from './highlight.ts'
import type { PaletteItem } from './GraphView.tsx'
import { Inspector } from './Inspector.tsx'
import { autoLayout } from './layout.ts'
import { Palette } from './Palette.tsx'
import { PreviewPane } from './PreviewPane.tsx'
import type { PreviewMode } from './PreviewPane.tsx'
import {
  addComponent,
  defaultComponent,
  deleteComponent,
  duplicateComponent,
  duplicateProject,
  fileContent,
  markRemoved,
  markSaved,
  NAME,
  newProject,
  projectKey,
  sampleFor,
  setSample,
  pendingCount,
  renameComponent,
  renameProject,
  updateComponent,
  withMissingInputs,
} from './projects.ts'
import type { Outcome, Project, SampleData } from './projects.ts'
import {
  currentOf,
  enterComponent,
  exitTo,
  openTrail,
  renameInTrail,
  settleTrail,
  topOf,
} from './trail.ts'
import type { Trail } from './trail.ts'
import { instancesText, namesById, usageOf, usageCount } from './usage.ts'

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

/**
 * Ask for a project or component name with the browser's prompt. Undefined
 * when cancelled, or when the name is invalid or taken (after saying so).
 */
function askName(
  what: string,
  taken: (name: string) => boolean,
  suggestion = '',
  question = `Name for the new ${what}`,
): string | undefined {
  const name = window
    .prompt(`${question} (letters, digits, - and _):`, suggestion)
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

const PREVIEW_MODE_KEY = 'hackensack-next:preview-mode'

/** The viewer's last In context / Isolated choice. Storage can be unavailable; fall back quietly. */
function savedPreviewMode(): PreviewMode {
  try {
    return localStorage.getItem(PREVIEW_MODE_KEY) === 'isolated'
      ? 'isolated'
      : 'context'
  } catch {
    return 'context'
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
  const [previewMode, setPreviewMode] = useState(savedPreviewMode)
  const choosePreviewMode = (mode: PreviewMode) => {
    setPreviewMode(mode)
    try {
      localStorage.setItem(PREVIEW_MODE_KEY, mode)
    } catch {
      // Not remembered; fine.
    }
  }
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
  // Inside a definition the preview shows either the picture you came from
  // (in context) or the definition alone (isolated). The Sample data pane
  // edits the data of whatever the preview renders.
  const nested = trail.length > 1
  const isolated = nested && previewMode === 'isolated'
  const dataComponent = isolated ? component : top
  const dataSpec = isolated ? spec : topSpec
  const dataSample = isolated ? componentSample : sample
  const dataKey = `${current.key}/${dataComponent}`
  const [dataText, setDataText] = useState({
    key: '',
    text: '',
    error: undefined as string | undefined,
  })
  if (dataText.key !== dataKey)
    setDataText({
      key: dataKey,
      text: JSON.stringify(dataSample, null, 2),
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
    updateProject(current.key, (p) =>
      setSample(p, dataComponent, parsed as SampleData),
    )
  }

  // ---- render ----
  // Recompiles only when the library changes, not when sample data does.
  const program = useMemo(
    () => (library?.[top] ? compile(top, library) : undefined),
    [library, top],
  )
  // Inside a definition, origins let the preview pick out what the entered
  // instance drew; at the top level the render is exactly as it always was.
  const result = useMemo(
    () => program?.render(sample, { trackOrigins: nested }),
    [program, sample, nested],
  )
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

  // ---- preview ----
  // Isolated: the entered definition compiled on its own, with its own data.
  const isolatedProgram = useMemo(
    () =>
      isolated && library?.[component]
        ? compile(component, library)
        : undefined,
    [isolated, library, component],
  )
  const isolatedResult = useMemo(
    () => isolatedProgram?.render(componentSample),
    [isolatedProgram, componentSample],
  )
  // In context: the picture you came from, with the entered instance marked.
  const marked = useMemo(
    () =>
      markEntered(result?.output ?? [], nested ? enteredChain(trail) : []),
    [result, nested, trail],
  )
  const preview = isolated
    ? {
        output: isolatedResult?.output ?? [],
        problems: [
          ...(isolatedProgram?.errors ?? []),
          ...(isolatedResult?.errors ?? []),
        ],
        note:
          samples && !Object.hasOwn(samples, component)
            ? `No sample file for ${component}; using its input defaults.`
            : undefined,
      }
    : {
        output: marked.output,
        problems,
        note:
          nested && marked.drawn === 0
            ? `Not drawn in this picture: ${trail[trail.length - 1]?.via} draws nothing in ${top}.`
            : undefined,
      }

  // ---- saving ----
  const saving = useRef(false)
  const save = async () => {
    if (
      !project ||
      project.readOnly ||
      !workspace.canSave ||
      pendingCount(project) === 0 ||
      saving.current
    )
      return
    saving.current = true
    const snapshot = project
    // Only clear files that weren't changed again while saving.
    const settle = ({ written, deleted }: Committed) =>
      updateProject(projectKey(snapshot), (p) =>
        markRemoved(
          markSaved(
            p,
            written.filter(
              (f) => fileContent(p, f) === fileContent(snapshot, f),
            ),
          ),
          deleted,
        ),
      )
    try {
      const done = await commitProject(snapshot)
      settle(done)
      const parts = [
        done.written.length > 0 &&
          `saved ${done.written.length} ${done.written.length === 1 ? 'file' : 'files'}`,
        done.deleted.length > 0 &&
          `deleted ${done.deleted.length} ${done.deleted.length === 1 ? 'file' : 'files'}`,
      ].filter(Boolean)
      const text = parts.join(', ') || 'nothing to save'
      setStatus({ error: false, text: text[0]!.toUpperCase() + text.slice(1) })
    } catch (e) {
      if (e instanceof CommitError) settle(e.done)
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
  const anyUnsaved = workspace.projects.some((p) => pendingCount(p) > 0)
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
    const name = askName('component', (n) => Object.hasOwn(project.library, n))
    if (!name) return
    updateProject(current.key, (p) => addComponent(p, name))
    setCurrent((c) => ({ ...c, trail: openTrail(name) }))
    setSelected(undefined)
  }

  /**
   * Apply a component operation to the current project. It is checked
   * against the project as shown (to report a refusal), then applied to the
   * latest state. Returns the changed project, or undefined if refused.
   */
  const applyToProject = (
    operation: (p: Project) => Outcome,
  ): Project | undefined => {
    if (!project) return undefined
    const outcome = operation(project)
    if ('error' in outcome) {
      setStatus({ error: true, text: outcome.error })
      return undefined
    }
    updateProject(current.key, (p) => {
      const latest = operation(p)
      return 'project' in latest ? latest.project : p
    })
    return outcome.project
  }

  /** Rename the component being edited. Its instances follow (they refer to its id). */
  const renameCurrentComponent = () => {
    if (!project) return
    const name = askName(
      'component',
      (n) => n !== component && Object.hasOwn(project.library, n),
      component,
      `New name for ${component}`,
    )
    if (!name || name === component) return
    if (!applyToProject((p) => renameComponent(p, component, name))) return
    setCurrent((c) => ({
      ...c,
      trail: renameInTrail(c.trail, component, name),
    }))
    setStatus({
      error: false,
      text: `Renamed ${component} to ${name}. Save to rename its file.`,
    })
  }

  /** Copy the component being edited under a new name, and open the copy. */
  const duplicateCurrentComponent = () => {
    if (!project) return
    const name = askName(
      'component',
      (n) => Object.hasOwn(project.library, n),
      `${component}-copy`,
      `Name for the copy of ${component}`,
    )
    if (!name) return
    if (!applyToProject((p) => duplicateComponent(p, component, name))) return
    setCurrent((c) => ({ ...c, trail: openTrail(name) }))
    setSelected(undefined)
    setStatus({ error: false, text: `Copied ${component} to ${name}.` })
  }

  /** Delete the component being edited, after saying what uses it. */
  const deleteCurrentComponent = () => {
    if (!project) return
    const refused = deleteComponent(project, component)
    if ('error' in refused) {
      setStatus({ error: true, text: refused.error })
      return
    }
    const uses = usageCount(usage, component)
    const confirmed = window.confirm(
      [
        `Delete the component ${component}?`,
        uses > 0
          ? `It has ${instancesText(uses)} in this project. They stay where they are, but show as "missing component" and draw nothing until you choose another definition.`
          : 'Nothing in this project uses it.',
        'Its file is deleted from disk when you save.',
      ].join('\n\n'),
    )
    if (!confirmed) return
    const after = applyToProject((p) => deleteComponent(p, component))
    if (!after) return
    setCurrent((c) => ({ ...c, trail: settleTrail(c.trail, after) }))
    setSelected(undefined)
    setStatus({
      error: false,
      text: `Deleted ${component}. Save to delete its file.`,
    })
  }

  /** Rename the current project: its folder first, when it has one. */
  const renameCurrentProject = async () => {
    if (!project || project.readOnly) return
    const name = askName(
      'project',
      (n) => n !== project.name && writable.some((p) => p.name === n),
      project.name,
      `New name for the project ${project.name}`,
    )
    if (!name || name === project.name) return
    const checked = renameProject(project, name, workspace.projects)
    if ('error' in checked) {
      setStatus({ error: true, text: checked.error })
      return
    }
    if (project.onDisk) {
      try {
        await renameProjectOnDisk(project, name)
      } catch (e) {
        setStatus({ error: true, text: (e as Error).message })
        return
      }
    }
    const key = projectKey(project)
    setWorkspace((w) => ({
      ...w,
      projects: w.projects.map((p) =>
        projectKey(p) === key ? { ...p, name } : p,
      ),
    }))
    setCurrent((c) =>
      c.key === key
        ? { ...c, key: projectKey({ root: project.root, name }) }
        : c,
    )
    setStatus({
      error: false,
      text: project.onDisk
        ? `Renamed the project to ${name}.`
        : `Renamed the project to ${name}. Save to write it to disk.`,
    })
  }

  /** Delete the current project, folder and all, and open another one. */
  const deleteCurrentProject = async () => {
    if (!project || project.readOnly) return
    const pending = pendingCount(project)
    const confirmed = window.confirm(
      [
        `Delete the project ${project.name}?`,
        project.onDisk
          ? `Its folder ${project.root}/${project.name} and the component and sample files in it are deleted from disk. This can't be undone.`
          : "It hasn't been saved, so there is nothing on disk to delete.",
        pending > 0 &&
          `It has unsaved changes (${pending} ${pending === 1 ? 'file' : 'files'}) that will be lost.`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
    if (!confirmed) return
    if (project.onDisk) {
      try {
        await deleteProjectOnDisk(project)
      } catch (e) {
        setStatus({ error: true, text: (e as Error).message })
        return
      }
    }
    const key = projectKey(project)
    const rest = workspace.projects.filter((p) => projectKey(p) !== key)
    setWorkspace((w) => ({
      ...w,
      projects: w.projects.filter((p) => projectKey(p) !== key),
    }))
    const next = rest.find((p) => !p.readOnly) ?? rest[0]
    if (next) open(next)
    else setCurrent({ key: '', trail: openTrail('') })
    setStatus({ error: false, text: `Deleted the project ${project.name}.` })
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
    if (!dataSpec) return undefined
    const filled = withMissingInputs(dataSample, dataSpec.inputs ?? {})
    if (!filled) return undefined
    return () => {
      setDataText({
        key: dataKey,
        text: JSON.stringify(filled, null, 2),
        error: undefined,
      })
      updateProject(current.key, (p) => setSample(p, dataComponent, filled))
    }
  })()

  const projectOptions = (readOnly: boolean) =>
    workspace.projects
      .filter((p) => p.readOnly === readOnly)
      .map((p) => (
        <option key={projectKey(p)} value={projectKey(p)}>
          {p.name}
          {pendingCount(p) > 0 ? ' •' : ''}
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
        <div className="topbar-actions">
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
            <>
              <button
                type="button"
                onClick={() => void renameCurrentProject()}
                title="Rename this project (and its folder, if it has been saved)"
              >
                Rename project…
              </button>
              <button
                type="button"
                onClick={duplicate}
                title="Copy this project under a new name"
              >
                Duplicate project…
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void deleteCurrentProject()}
                title="Delete this project and its folder"
              >
                Delete project…
              </button>
            </>
          )}
        </div>
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
        {project && !project.readOnly && (
          <div className="topbar-actions">
            <button type="button" onClick={createComponent}>
              New component
            </button>
            {spec && (
              <>
                <button
                  type="button"
                  onClick={renameCurrentComponent}
                  title={`Rename ${component}; its instances keep working`}
                >
                  Rename component…
                </button>
                <button
                  type="button"
                  onClick={duplicateCurrentComponent}
                  title={`Copy ${component} under a new name`}
                >
                  Duplicate component…
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={deleteCurrentComponent}
                  title={`Delete ${component}`}
                >
                  Delete component…
                </button>
              </>
            )}
          </div>
        )}
        {project && !project.readOnly && workspace.canSave && (
          <button
            type="button"
            className="primary"
            disabled={pendingCount(project) === 0}
            onClick={() => void save()}
            title="Save changed files and delete removed ones (Ctrl+S)"
          >
            {pendingCount(project) > 0
              ? `Save (${pendingCount(project)})`
              : 'Saved'}
          </button>
        )}
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
        title={
          isolated
            ? `Preview · ${component} alone`
            : nested
              ? `Preview · ${top}`
              : 'Preview'
        }
        area="preview"
      >
        <PreviewPane
          output={preview.output}
          problems={preview.problems}
          mode={nested ? previewMode : undefined}
          onMode={choosePreviewMode}
          note={preview.note}
        />
      </Pane>

      <Pane
        title={nested ? `Sample data · ${dataComponent}` : 'Sample data'}
        area="data"
      >
        {dataSpec && (
          <DataPane
            inputs={dataSpec.inputs ?? {}}
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
