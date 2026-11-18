// Projects: a component library plus sample data, in the layout PLAN.md
// describes (`components/<name>.json`, `samples/<name>.data.json`), and the
// pure operations the editor performs on them. Nothing here touches disk;
// api.ts loads and saves.

import { SPEC_FORMAT } from '../engine/index.ts'
import type { ComponentSpec, InputDecl } from '../engine/index.ts'
import { defaultRandom, idsIn, newId } from './ids.ts'
import type { RandomBytes } from './ids.ts'
import { upgradeLibrary } from './upgrade.ts'

export type SampleData = Record<string, unknown>

/** A file inside a project, e.g. "components/sun" or "samples/sun". */
export type ProjectFile = `${'components' | 'samples'}/${string}`

export interface Project {
  /** Which store root it lives in: "examples" (read-only) or "projects". */
  root: string
  name: string
  readOnly: boolean
  library: Readonly<Record<string, ComponentSpec>>
  /** Sample data by component name. */
  samples: Readonly<Record<string, SampleData>>
  /** Files changed in the editor but not saved yet. */
  unsaved: readonly ProjectFile[]
  /**
   * Files to delete from disk on the next save: the old files of renamed and
   * deleted components. Never overlaps `unsaved`.
   */
  removed: readonly ProjectFile[]
  /** Whether the project's folder exists on disk (a new or duplicated project only gets one when first saved). */
  onDisk: boolean
  /** Files that couldn't be loaded. */
  problems: readonly string[]
}

export const projectKey = (p: Pick<Project, 'root' | 'name'>) =>
  `${p.root}/${p.name}`

/** Project, component and sample names (same rule as the file store). */
export const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

const sortByName = <T>(
  record: Readonly<Record<string, T>>,
): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  )

/** What the file store returns for one project. */
export interface ProjectFiles {
  root: string
  name: string
  readOnly: boolean
  components: Record<string, unknown>
  samples: Record<string, unknown>
  problems: string[]
}

/**
 * A project from its files. v2 component files are upgraded to v3 in memory
 * (see upgrade.ts); in a writable project they are marked unsaved, so the
 * next save writes them back upgraded.
 */
export function fromFiles(
  files: ProjectFiles,
  random: RandomBytes = defaultRandom,
): Project {
  const { library, changed } = upgradeLibrary(files.components, random)
  return {
    root: files.root,
    name: files.name,
    readOnly: files.readOnly,
    library: sortByName(library),
    samples: files.samples as Record<string, SampleData>,
    unsaved: files.readOnly
      ? []
      : changed.map((name): ProjectFile => `components/${name}`),
    removed: [],
    onDisk: true,
    problems: files.problems,
  }
}

const COMPONENT_PATH = /\/([^/]+)\/components\/([^/]+)\.json$/
const SAMPLE_PATH = /\/([^/]+)\/samples\/([^/]+)\.data\.json$/

/**
 * Group bundled example files (from import.meta.glob) into read-only
 * projects by their paths. Used when there is no dev server to ask.
 */
export function groupProjectFiles(
  componentFiles: Readonly<Record<string, unknown>>,
  sampleFiles: Readonly<Record<string, unknown>>,
): Project[] {
  const projects = new Map<string, ProjectFiles>()
  const entry = (name: string) => {
    let project = projects.get(name)
    if (!project) {
      project = {
        root: 'examples',
        name,
        readOnly: true,
        components: {},
        samples: {},
        problems: [],
      }
      projects.set(name, project)
    }
    return project
  }
  for (const [path, content] of Object.entries(componentFiles)) {
    const match = COMPONENT_PATH.exec(path)
    if (match) entry(match[1]!).components[match[2]!] = content
  }
  for (const [path, content] of Object.entries(sampleFiles)) {
    const match = SAMPLE_PATH.exec(path)
    if (match) entry(match[1]!).samples[match[2]!] = content
  }
  return sortProjects([...projects.values()].map(fromFiles))
}

/** Writable projects first, then examples; each group by name. */
export function sortProjects(projects: readonly Project[]): Project[] {
  return [...projects].sort(
    (a, b) =>
      Number(a.readOnly) - Number(b.readOnly) || a.name.localeCompare(b.name),
  )
}

/**
 * The data to start a component's preview with: its sample file if the
 * project has one, otherwise the declared defaults of its inputs.
 */
export function sampleFor(
  project: Pick<Project, 'library' | 'samples'>,
  component: string,
): SampleData {
  const sample = project.samples[component]
  if (sample) return sample
  const inputs = project.library[component]?.inputs ?? {}
  return Object.fromEntries(
    Object.entries(inputs)
      .filter(([, decl]) => 'default' in decl)
      .map(([name, decl]) => [name, decl.default]),
  )
}

/** The project's pending-file lists with `file` to be written on save. */
const markUnsaved = (
  project: Pick<Project, 'unsaved' | 'removed'>,
  file: ProjectFile,
): Pick<Project, 'unsaved' | 'removed'> => ({
  unsaved: project.unsaved.includes(file)
    ? project.unsaved
    : [...project.unsaved, file],
  removed: project.removed.filter((f) => f !== file),
})

/** The project's pending-file lists with `file` to be deleted on save. */
const queueRemoval = (
  project: Pick<Project, 'unsaved' | 'removed'>,
  file: ProjectFile,
): Pick<Project, 'unsaved' | 'removed'> => ({
  unsaved: project.unsaved.filter((f) => f !== file),
  removed: project.removed.includes(file)
    ? project.removed
    : [...project.removed, file],
})

/** How many file writes and deletions the next save will do. */
export const pendingCount = (project: Pick<Project, 'unsaved' | 'removed'>) =>
  project.unsaved.length + project.removed.length

/** The component a project opens on: the one named after the project, else the first. */
export function defaultComponent(
  project: Pick<Project, 'name' | 'library'>,
): string {
  const names = Object.keys(project.library)
  return names.includes(project.name) ? project.name : (names[0] ?? '')
}

export function updateComponent(
  project: Project,
  name: string,
  update: (spec: ComponentSpec) => ComponentSpec,
): Project {
  const spec = project.library[name]
  if (!spec) return project
  const next = update(spec)
  if (next === spec) return project
  return {
    ...project,
    library: { ...project.library, [name]: next },
    ...markUnsaved(project, `components/${name}`),
  }
}

export function setSample(
  project: Project,
  component: string,
  data: SampleData,
): Project {
  return {
    ...project,
    samples: { ...project.samples, [component]: data },
    ...markUnsaved(project, `samples/${component}`),
  }
}

/** A new component with the given id: an empty 400 × 400 picture. */
export function blankComponent(id: string): ComponentSpec {
  return {
    format: SPEC_FORMAT,
    id,
    inputs: {},
    root: 'n0',
    nodes: { n0: { type: 'svg', params: { width: 400, height: 400 } } },
    editor: { n0: { x: 0, y: 0 } },
  }
}

/** Add a component; a blank one with a new id unless `spec` is given. */
export function addComponent(
  project: Project,
  name: string,
  spec: ComponentSpec = blankComponent(newId(idsIn(project.library))),
): Project {
  return {
    ...project,
    library: sortByName({ ...project.library, [name]: spec }),
    ...markUnsaved(project, `components/${name}`),
  }
}

export function newProject(
  root: string,
  name: string,
  random: RandomBytes = defaultRandom,
): Project {
  return addComponent(
    {
      root,
      name,
      readOnly: false,
      library: {},
      samples: {},
      unsaved: [],
      removed: [],
      onDisk: false,
      problems: [],
    },
    name,
    blankComponent(newId([], random)),
  )
}

/** A writable copy of a project (e.g. of an example), every file unsaved. */
export function duplicateProject(
  project: Project,
  root: string,
  name: string,
): Project {
  return {
    root,
    name,
    readOnly: false,
    library: project.library,
    samples: project.samples,
    unsaved: [
      ...Object.keys(project.library).map(
        (c): ProjectFile => `components/${c}`,
      ),
      ...Object.keys(project.samples).map((s): ProjectFile => `samples/${s}`),
    ],
    removed: [],
    onDisk: false,
    problems: [],
  }
}

/** After a save wrote `saved`: they are no longer unsaved, and the project is on disk. */
export function markSaved(
  project: Project,
  saved: readonly ProjectFile[],
): Project {
  if (saved.length === 0) return project
  return {
    ...project,
    unsaved: project.unsaved.filter((f) => !saved.includes(f)),
    onDisk: true,
  }
}

/** After a save deleted `deleted` from disk: they are no longer queued for removal. */
export function markRemoved(
  project: Project,
  deleted: readonly ProjectFile[],
): Project {
  if (deleted.length === 0) return project
  return {
    ...project,
    removed: project.removed.filter((f) => !deleted.includes(f)),
  }
}

/** The result of an operation that can be refused, with the reason. */
export type Outcome = { project: Project } | { error: string }

/** Why `name` can't be a new component name in `project`, if it can't. */
function componentNameProblem(
  project: Project,
  name: string,
): string | undefined {
  if (!NAME.test(name))
    return `"${name}" isn't a valid name. Use letters, digits, - and _, starting with a letter or digit.`
  if (Object.hasOwn(project.library, name))
    return `There is already a component named "${name}".`
  return undefined
}

const withoutKey = <T>(record: Readonly<Record<string, T>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))

/**
 * Rename a component. Its id stays the same, so its instances keep working
 * and no other file changes; its sample data moves with it. The new files are
 * marked unsaved and the old ones queued for deletion on the next save.
 */
export function renameComponent(
  project: Project,
  from: string,
  to: string,
): Outcome {
  if (project.readOnly) return { error: `${project.name} is read-only.` }
  const spec = Object.hasOwn(project.library, from)
    ? project.library[from]
    : undefined
  if (!spec) return { error: `There is no component named "${from}".` }
  if (to === from) return { project }
  const problem = componentNameProblem(project, to)
  if (problem) return { error: problem }
  let pending = queueRemoval(
    markUnsaved(project, `components/${to}`),
    `components/${from}`,
  )
  let samples = project.samples
  if (Object.hasOwn(samples, from)) {
    samples = { ...withoutKey(samples, from), [to]: samples[from]! }
    pending = queueRemoval(
      markUnsaved(pending, `samples/${to}`),
      `samples/${from}`,
    )
  }
  return {
    project: {
      ...project,
      library: sortByName({ ...withoutKey(project.library, from), [to]: spec }),
      samples,
      ...pending,
    },
  }
}

/** Copy a component under a new name, with a new id and a copy of its sample data. */
export function duplicateComponent(
  project: Project,
  from: string,
  to: string,
  random: RandomBytes = defaultRandom,
): Outcome {
  if (project.readOnly) return { error: `${project.name} is read-only.` }
  const spec = Object.hasOwn(project.library, from)
    ? project.library[from]
    : undefined
  if (!spec) return { error: `There is no component named "${from}".` }
  const problem = componentNameProblem(project, to)
  if (problem) return { error: problem }
  const copy: ComponentSpec = {
    ...spec,
    id: newId(idsIn(project.library), random),
  }
  let pending = markUnsaved(project, `components/${to}`)
  let samples = project.samples
  if (Object.hasOwn(samples, from)) {
    samples = { ...samples, [to]: samples[from]! }
    pending = markUnsaved(pending, `samples/${to}`)
  }
  return {
    project: {
      ...project,
      library: sortByName({ ...project.library, [to]: copy }),
      samples,
      ...pending,
    },
  }
}

/**
 * Delete a component and its sample data; their files are queued for
 * deletion on the next save. Instances of it elsewhere are left as they are,
 * pointing at an id nothing has (they render nothing and report it). The last
 * component can't be deleted: a project without components isn't a project.
 */
export function deleteComponent(project: Project, name: string): Outcome {
  if (project.readOnly) return { error: `${project.name} is read-only.` }
  if (!Object.hasOwn(project.library, name))
    return { error: `There is no component named "${name}".` }
  if (Object.keys(project.library).length === 1)
    return {
      error: `${name} is the project's only component. Delete the project instead.`,
    }
  let pending = queueRemoval(project, `components/${name}`)
  if (Object.hasOwn(project.samples, name))
    pending = queueRemoval(pending, `samples/${name}`)
  return {
    project: {
      ...project,
      library: withoutKey(project.library, name),
      samples: withoutKey(project.samples, name),
      ...pending,
    },
  }
}

/**
 * Rename a project in memory: everything else, unsaved edits and queued
 * deletions included, carries over (their paths are relative to the project).
 * Moving its folder on disk is the caller's job (api.ts).
 */
export function renameProject(
  project: Project,
  name: string,
  others: readonly Project[],
): Outcome {
  if (project.readOnly) return { error: `${project.name} is read-only.` }
  if (name === project.name) return { project }
  if (!NAME.test(name))
    return {
      error: `"${name}" isn't a valid name. Use letters, digits, - and _, starting with a letter or digit.`,
    }
  if (
    others.some(
      (p) => p !== project && p.root === project.root && p.name === name,
    )
  )
    return { error: `There is already a project named "${name}".` }
  return { project: { ...project, name } }
}

/** The current (possibly unsaved) content of one project file. */
export function fileContent(
  project: Project,
  file: ProjectFile,
): object | undefined {
  const [kind, name] = file.split('/') as ['components' | 'samples', string]
  return kind === 'components' ? project.library[name] : project.samples[name]
}

const EMPTY_VALUE: Record<string, unknown> = {
  number: 0,
  string: '',
  boolean: false,
  list: [],
  object: {},
  any: null,
}

/**
 * Sample data with every declared input it lacks filled in: the input's
 * default, or an empty value of its type. Undefined if nothing is missing.
 */
export function withMissingInputs(
  data: SampleData,
  inputs: Readonly<Record<string, InputDecl>>,
): SampleData | undefined {
  const missing = Object.entries(inputs).filter(([name]) => !(name in data))
  if (missing.length === 0) return undefined
  return {
    ...data,
    ...Object.fromEntries(
      missing.map(([name, decl]) => [
        name,
        'default' in decl ? decl.default : EMPTY_VALUE[decl.type ?? 'any'],
      ]),
    ),
  }
}
