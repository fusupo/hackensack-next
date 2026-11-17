// Projects: a component library plus sample data, in the layout PLAN.md
// describes (`components/<name>.json`, `samples/<name>.data.json`).
// Pure functions; examples.ts feeds them the files bundled by Vite.

import type { ComponentSpec, Library } from '../engine/index.ts'

export type SampleData = Record<string, unknown>

export interface Project {
  name: string
  library: Library
  /** Sample data by component name. */
  samples: Readonly<Record<string, SampleData>>
}

const COMPONENT_PATH = /\/([^/]+)\/components\/([^/]+)\.json$/
const SAMPLE_PATH = /\/([^/]+)\/samples\/([^/]+)\.data\.json$/

/**
 * Group loaded files into projects by their paths:
 * `…/<project>/components/<name>.json` and `…/<project>/samples/<name>.data.json`.
 * Files with other paths are ignored. Projects and components come out sorted by name.
 */
export function groupProjectFiles(
  componentFiles: Readonly<Record<string, unknown>>,
  sampleFiles: Readonly<Record<string, unknown>>,
): Project[] {
  const projects = new Map<
    string,
    {
      library: Record<string, ComponentSpec>
      samples: Record<string, SampleData>
    }
  >()
  const entry = (name: string) => {
    let project = projects.get(name)
    if (!project) {
      project = { library: {}, samples: {} }
      projects.set(name, project)
    }
    return project
  }
  for (const [path, content] of Object.entries(componentFiles)) {
    const match = COMPONENT_PATH.exec(path)
    if (match) entry(match[1]!).library[match[2]!] = content as ComponentSpec
  }
  for (const [path, content] of Object.entries(sampleFiles)) {
    const match = SAMPLE_PATH.exec(path)
    if (match) entry(match[1]!).samples[match[2]!] = content as SampleData
  }
  return [...projects.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { library, samples }]) => ({
      name,
      library: Object.fromEntries(
        Object.entries(library).sort(([a], [b]) => a.localeCompare(b)),
      ),
      samples,
    }))
}

/**
 * The data to start a component's preview with: its sample file if the
 * project has one, otherwise the declared defaults of its inputs.
 */
export function sampleFor(project: Project, component: string): SampleData {
  const sample = project.samples[component]
  if (sample) return sample
  const inputs = project.library[component]?.inputs ?? {}
  return Object.fromEntries(
    Object.entries(inputs)
      .filter(([, decl]) => 'default' in decl)
      .map(([name, decl]) => [name, decl.default]),
  )
}
