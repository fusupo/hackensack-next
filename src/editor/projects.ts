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

const markUnsaved = (
  project: Project,
  file: ProjectFile,
): readonly ProjectFile[] =>
  project.unsaved.includes(file) ? project.unsaved : [...project.unsaved, file]

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
    unsaved: markUnsaved(project, `components/${name}`),
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
    unsaved: markUnsaved(project, `samples/${component}`),
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
    unsaved: markUnsaved(project, `components/${name}`),
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
    problems: [],
  }
}

export function markSaved(
  project: Project,
  saved: readonly ProjectFile[],
): Project {
  return {
    ...project,
    unsaved: project.unsaved.filter((f) => !saved.includes(f)),
  }
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
