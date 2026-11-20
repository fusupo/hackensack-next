// The ProjectStorage behind the dev server: HTTP to the plugin in
// server/plugin.ts, which reads and writes the project folders. The only
// editor file that knows the plugin's URLs and header (storage.test.ts checks
// it); src/main.tsx creates it and hands it to the editor.
//
//   GET    /__hackensack/projects                                -> ProjectFiles[]
//   PUT    /__hackensack/projects/<root>/<project>/<kind>/<name>  body: JSON object
//   DELETE /__hackensack/projects/<root>/<project>/<kind>/<name>
//   POST   /__hackensack/projects/<root>/<project>/rename         body: {"name": "<new>"}
//   DELETE /__hackensack/projects/<root>/<project>
//
// Every change carries `X-Hackensack: 1`. A refusal from the plugin (a not-ok
// answer) is a StorageError with the plugin's `error` text, else the HTTP
// status; a request that fails outright (no server) is passed on unchanged.

import type { ProjectFiles } from './projects.ts'
import { StorageError } from './storage.ts'
import type { ProjectRef, ProjectStorage } from './storage.ts'

export const API = '/__hackensack/projects'

/** `fetch`, narrowed to what the storage uses; tests pass a stub. */
export type Send = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const fetchSend: Send = (url, init) => fetch(url, init)

const projectUrl = (project: ProjectRef) =>
  `${API}/${encodeURIComponent(project.root)}/${encodeURIComponent(project.name)}`

/** The error message in a failed response, else the HTTP status. */
async function failure(response: {
  status: number
  json(): Promise<unknown>
}): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  return body.error ?? `HTTP ${response.status}`
}

export function devServerStorage(send: Send = fetchSend): ProjectStorage {
  /** Send a request; a not-ok answer becomes a StorageError. */
  const request = async (url: string, init: Parameters<Send>[1]) => {
    const response = await send(url, init)
    if (!response.ok) throw new StorageError(await failure(response))
    return response
  }
  return {
    async list() {
      const response = await request(API, { method: 'GET', headers: {} })
      return (await response.json()) as ProjectFiles[]
    },
    async writeFile(project, file, content) {
      await request(`${projectUrl(project)}/${file}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Hackensack': '1' },
        body: JSON.stringify(content),
      })
    },
    async deleteFile(project, file) {
      await request(`${projectUrl(project)}/${file}`, {
        method: 'DELETE',
        headers: { 'X-Hackensack': '1' },
      })
    },
    async renameProject(project, name) {
      await request(`${projectUrl(project)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hackensack': '1' },
        body: JSON.stringify({ name }),
      })
    },
    async deleteProject(project) {
      await request(projectUrl(project), {
        method: 'DELETE',
        headers: { 'X-Hackensack': '1' },
      })
    },
  }
}
