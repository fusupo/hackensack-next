// Talking to the dev-server plugin (server/plugin.ts).

import { EXAMPLE_PROJECTS } from './examples.ts'
import { fileContent, fromFiles, sortProjects } from './projects.ts'
import type { Project, ProjectFile, ProjectFiles } from './projects.ts'

const API = '/__hackensack/projects'

export interface Workspace {
  projects: Project[]
  /** False when there is no dev server (e.g. a production build): nothing can be saved. */
  canSave: boolean
}

/** Load every project from the dev server, or fall back to the bundled examples. */
export async function loadWorkspace(): Promise<Workspace> {
  try {
    const response = await fetch(API)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const files = (await response.json()) as ProjectFiles[]
    return { projects: sortProjects(files.map(fromFiles)), canSave: true }
  } catch {
    return { projects: EXAMPLE_PROJECTS, canSave: false }
  }
}

/** Save the given files of a project. Returns the files that were saved; throws on the first failure. */
export async function saveFiles(
  project: Project,
  files: readonly ProjectFile[],
): Promise<ProjectFile[]> {
  const saved: ProjectFile[] = []
  for (const file of files) {
    const content = fileContent(project, file)
    if (content === undefined) continue
    const response = await fetch(
      `${API}/${encodeURIComponent(project.root)}/${encodeURIComponent(project.name)}/${file}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Hackensack': '1' },
        body: JSON.stringify(content),
      },
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      throw new Error(
        `Couldn't save ${file}: ${body.error ?? `HTTP ${response.status}`}`,
      )
    }
    saved.push(file)
  }
  return saved
}
