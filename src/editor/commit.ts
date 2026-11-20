// Saving a project: write every unsaved file, then delete the files queued
// for removal (renamed and deleted components). Writes come first so an
// interrupted save never loses a definition: at worst a renamed component
// exists under both names, which the engine reports as a duplicate id.
//
// The files go through a ProjectStorage (storage.ts): the dev-server one in
// the editor, an in-memory one in tests.

import { fileContent } from './projects.ts'
import type { Project, ProjectFile } from './projects.ts'
import { StorageError } from './storage.ts'
import type { ProjectStorage } from './storage.ts'

export interface Committed {
  /** Files written, in order. */
  written: ProjectFile[]
  /** Files deleted, in order. */
  deleted: ProjectFile[]
}

/** A save that stopped part way; says what it had done by then. */
export class CommitError extends Error {
  readonly done: Committed
  constructor(message: string, done: Committed) {
    super(message)
    this.done = done
  }
}

/**
 * Write `project.unsaved`, then delete `project.removed`. Stops at the first
 * failure; no deletion is asked for once a write has failed. A refusal from
 * the storage becomes a CommitError saying which file and what was done; any
 * other error (no server at all, say) is passed on as it is.
 */
export async function commitProject(
  project: Project,
  storage: ProjectStorage,
): Promise<Committed> {
  const done: Committed = { written: [], deleted: [] }
  const step = async (
    verb: string,
    file: ProjectFile,
    action: () => Promise<void>,
  ) => {
    try {
      await action()
    } catch (e) {
      if (e instanceof StorageError)
        throw new CommitError(`Couldn't ${verb} ${file}: ${e.message}`, done)
      throw e
    }
  }
  for (const file of project.unsaved) {
    const content = fileContent(project, file)
    if (content === undefined) continue
    await step('save', file, () => storage.writeFile(project, file, content))
    done.written.push(file)
  }
  for (const file of project.removed) {
    await step('delete', file, () => storage.deleteFile(project, file))
    done.deleted.push(file)
  }
  return done
}
