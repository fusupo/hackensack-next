// Vite dev-server plugin: lets the editor list and save project files.
//
//   GET    /__hackensack/projects                                -> every project (ProjectFiles[])
//   PUT    /__hackensack/projects/<root>/<project>/<kind>/<name>  body: JSON object
//   DELETE /__hackensack/projects/<root>/<project>/<kind>/<name>  delete one file
//   POST   /__hackensack/projects/<root>/<project>/rename         body: {"name": "<new>"}
//   DELETE /__hackensack/projects/<root>/<project>                delete the project
//
// Dev only (there is no server in a production build; the editor then falls
// back to the bundled examples, read-only). Every request that changes files must carry the header
// `X-Hackensack: 1`: browsers can't send a custom header cross-origin without a
// preflight this server never approves, so other web pages can't write files.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  deleteFile,
  deleteProject,
  listProjects,
  renameProject,
  saveFile,
  StoreError,
} from './projectStore.ts'
import type { StoreRoot } from './projectStore.ts'

export const API_PATH = '/__hackensack/projects'
const MAX_BODY = 1_000_000

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new StoreError(413, 'file too large')
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new StoreError(400, 'body is not valid JSON')
  }
}

export function projectFiles(roots: readonly StoreRoot[]): Plugin {
  return {
    name: 'hackensack-project-files',
    configureServer(server) {
      server.middlewares.use(API_PATH, (req, res) => {
        void (async () => {
          try {
            const parts = (req.url ?? '/')
              .split('?')[0]!
              .split('/')
              .filter(Boolean)
              .map(decodeURIComponent)
            if (req.method === 'GET' && parts.length === 0) {
              send(res, 200, await listProjects(roots))
              return
            }
            // Everything below changes files.
            if (req.headers['x-hackensack'] !== '1')
              throw new StoreError(403, 'missing X-Hackensack header')
            const log = (message: string) =>
              server.config.logger.info(message, { timestamp: true })
            if (req.method === 'DELETE' && parts.length === 4) {
              const [root, project, kind, name] = parts as [
                string,
                string,
                string,
                string,
              ]
              const path = await deleteFile(roots, {
                root,
                project,
                kind,
                name,
              })
              log(`deleted ${path}`)
              send(res, 200, { deleted: path })
              return
            }
            if (
              req.method === 'POST' &&
              parts.length === 3 &&
              parts[2] === 'rename'
            ) {
              const [root, project] = parts as [string, string]
              const body = await readBody(req)
              const to =
                typeof body === 'object' && body !== null && 'name' in body
                  ? (body as { name: unknown }).name
                  : undefined
              if (typeof to !== 'string')
                throw new StoreError(400, 'body must be {"name": "<new name>"}')
              const path = await renameProject(roots, { root, project, to })
              log(`renamed ${root}/${project} to ${path}`)
              send(res, 200, { renamed: path })
              return
            }
            if (req.method === 'DELETE' && parts.length === 2) {
              const [root, project] = parts as [string, string]
              const path = await deleteProject(roots, { root, project })
              log(`deleted project ${path}`)
              send(res, 200, { deleted: path })
              return
            }
            if (req.method === 'PUT' && parts.length === 4) {
              const [root, project, kind, name] = parts as [
                string,
                string,
                string,
                string,
              ]
              const path = await saveFile(roots, {
                root,
                project,
                kind,
                name,
                content: await readBody(req),
              })
              log(`saved ${path}`)
              send(res, 200, { saved: path })
              return
            }
            throw new StoreError(404, 'not found')
          } catch (e) {
            const status = e instanceof StoreError ? e.status : 500
            send(res, status, {
              error: e instanceof Error ? e.message : String(e),
            })
          }
        })()
      })
    },
  }
}
