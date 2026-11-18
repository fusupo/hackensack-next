// Saving a project: write every unsaved file, then delete the files queued
// for removal (renamed and deleted components). Writes come first so an
// interrupted save never loses a definition: at worst a renamed component
// exists under both names, which the engine reports as a duplicate id.
//
// `send` is `fetch` in the editor and a stub in tests.

import { fileContent } from './projects.ts'
import type { Project, ProjectFile } from './projects.ts'

export const API = '/__hackensack/projects'

export type Send = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const fetchSend: Send = (url, init) => fetch(url, init)

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

export const projectUrl = (project: Pick<Project, 'root' | 'name'>) =>
  `${API}/${encodeURIComponent(project.root)}/${encodeURIComponent(project.name)}`

/** The error message in a failed response, else the HTTP status. */
export async function failure(response: {
  status: number
  json(): Promise<unknown>
}): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  return body.error ?? `HTTP ${response.status}`
}

/**
 * Write `project.unsaved`, then delete `project.removed`. Stops at the first
 * failure, throwing a CommitError with what was done; no deletion is sent
 * once a write has failed.
 */
export async function commitProject(
  project: Project,
  send: Send = fetchSend,
): Promise<Committed> {
  const done: Committed = { written: [], deleted: [] }
  const base = projectUrl(project)
  for (const file of project.unsaved) {
    const content = fileContent(project, file)
    if (content === undefined) continue
    const response = await send(`${base}/${file}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Hackensack': '1' },
      body: JSON.stringify(content),
    })
    if (!response.ok)
      throw new CommitError(
        `Couldn't save ${file}: ${await failure(response)}`,
        done,
      )
    done.written.push(file)
  }
  for (const file of project.removed) {
    const response = await send(`${base}/${file}`, {
      method: 'DELETE',
      headers: { 'X-Hackensack': '1' },
    })
    if (!response.ok)
      throw new CommitError(
        `Couldn't delete ${file}: ${await failure(response)}`,
        done,
      )
    done.deleted.push(file)
  }
  return done
}
