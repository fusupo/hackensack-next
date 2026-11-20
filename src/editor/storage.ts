// Where projects are kept, as the editor sees it (#41). The editor lists,
// writes and deletes project files only through a ProjectStorage, so it never
// knows what is behind it: today the dev-server plugin (devServerStorage.ts),
// later a desktop shell or the browser's file system access (#42). The entry
// point (src/main.tsx) picks the storage and hands it to the editor.
//
// The bundled read-only examples are not a storage: when listing fails,
// loadWorkspace (api.ts) falls back to them and nothing can be saved.

import type { Project, ProjectFile, ProjectFiles } from './projects.ts'

/** Which project an operation is about. */
export type ProjectRef = Pick<Project, 'root' | 'name'>

/**
 * The storage refused an operation. Its message is the bare reason
 * (`disk full`, `no project named "p" in projects`); callers add what they
 * were doing (`Couldn't save components/sun: disk full`). Any other error
 * (a network failure, say) is passed on as it is.
 */
export class StorageError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'StorageError'
  }
}

export interface ProjectStorage {
  /** Every project with its files, from every root (each says whether it is read-only). */
  list(): Promise<ProjectFiles[]>
  /** Write one component or sample file, creating the project's folder if needed. */
  writeFile(
    project: ProjectRef,
    file: ProjectFile,
    content: object,
  ): Promise<void>
  /** Delete one component or sample file; a file that is already gone is fine. */
  deleteFile(project: ProjectRef, file: ProjectFile): Promise<void>
  /** Rename a project within its root. */
  renameProject(project: ProjectRef, name: string): Promise<void>
  /** Delete a project and its files. */
  deleteProject(project: ProjectRef): Promise<void>
}
