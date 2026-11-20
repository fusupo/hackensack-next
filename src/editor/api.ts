// Loading the workspace and renaming or deleting a saved project, through a
// ProjectStorage (storage.ts). The editor is handed its storage by the entry
// point (src/main.tsx) and never knows what is behind it.

import { fromFiles, sortProjects } from './projects.ts'
import type { Project } from './projects.ts'
import { StorageError } from './storage.ts'
import type { ProjectRef, ProjectStorage } from './storage.ts'

export { commitProject, CommitError } from './commit.ts'

export interface Workspace {
  projects: Project[]
  /** False when the storage can't be reached (e.g. a production build with no dev server): nothing can be saved. */
  canSave: boolean
}

/**
 * Load every project from the storage. When it can't list them, show
 * `fallback` (the editor passes the bundled read-only examples) with nothing
 * savable.
 */
export async function loadWorkspace(
  storage: ProjectStorage,
  fallback: Project[],
): Promise<Workspace> {
  try {
    const files = await storage.list()
    return {
      projects: sortProjects(files.map((f) => fromFiles(f))),
      canSave: true,
    }
  } catch {
    return { projects: fallback, canSave: false }
  }
}

/** Says what was being done when the storage refused; other errors pass. */
async function attempt(what: string, action: () => Promise<void>) {
  try {
    await action()
  } catch (e) {
    if (e instanceof StorageError) throw new Error(`${what}: ${e.message}`)
    throw e
  }
}

/** Move a saved project's folder to a new name (same root). */
export const renameProjectOnDisk = (
  storage: ProjectStorage,
  project: ProjectRef,
  name: string,
): Promise<void> =>
  attempt(`Couldn't rename ${project.name}`, () =>
    storage.renameProject(project, name),
  )

/** Delete a saved project's folder. */
export const deleteProjectOnDisk = (
  storage: ProjectStorage,
  project: ProjectRef,
): Promise<void> =>
  attempt(`Couldn't delete ${project.name}`, () =>
    storage.deleteProject(project),
  )
