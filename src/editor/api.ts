// Talking to the dev-server plugin (server/plugin.ts).

import { API, failure, projectUrl } from './commit.ts'
import { EXAMPLE_PROJECTS } from './examples.ts'
import { fromFiles, sortProjects } from './projects.ts'
import type { Project, ProjectFiles } from './projects.ts'

export { commitProject, CommitError } from './commit.ts'

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
    return {
      projects: sortProjects(files.map((f) => fromFiles(f))),
      canSave: true,
    }
  } catch {
    return { projects: EXAMPLE_PROJECTS, canSave: false }
  }
}

/** Move a saved project's folder to a new name (same root). */
export async function renameProjectOnDisk(
  project: Pick<Project, 'root' | 'name'>,
  name: string,
): Promise<void> {
  const response = await fetch(`${projectUrl(project)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hackensack': '1' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok)
    throw new Error(
      `Couldn't rename ${project.name}: ${await failure(response)}`,
    )
}

/** Delete a saved project's folder. */
export async function deleteProjectOnDisk(
  project: Pick<Project, 'root' | 'name'>,
): Promise<void> {
  const response = await fetch(projectUrl(project), {
    method: 'DELETE',
    headers: { 'X-Hackensack': '1' },
  })
  if (!response.ok)
    throw new Error(
      `Couldn't delete ${project.name}: ${await failure(response)}`,
    )
}
