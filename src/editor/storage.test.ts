// The storage seam (#41): the in-memory storage, the dev-server storage's
// requests and errors, loading a workspace through a storage, and the guard
// that keeps the dev server's details in one file. Tests are top-level, so
// each one's name is exactly its title.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'
import { loadWorkspace } from './api.ts'
import { devServerStorage } from './devServerStorage.ts'
import type { Send } from './devServerStorage.ts'
import { memoryStorage } from './memoryStorage.ts'
import { fromFiles } from './projects.ts'
import type { ProjectFiles } from './projects.ts'
import { StorageError } from './storage.ts'
import type { ProjectStorage } from './storage.ts'

/** A project's files as a store lists them. */
const files = (
  root: string,
  name: string,
  readOnly = false,
  components: Record<string, unknown> = {},
): ProjectFiles => ({
  root,
  name,
  readOnly,
  components,
  samples: {},
  problems: [],
})

/** The error an operation rejects with, or 'no error'. */
const rejection = (operation: Promise<unknown>) =>
  operation.then(
    () => 'no error',
    (e: unknown) => e,
  )

it('the in-memory storage lists, writes, deletes, renames and deletes projects through ProjectStorage', async () => {
  const sun = { format: 'hackensack/4', id: 'id-sun' }
  const storage: ProjectStorage = memoryStorage([
    files('examples', 'sun-card', true, { sun }),
    files('projects', 'p', false, { sun }),
  ])
  const p = { root: 'projects', name: 'p' }

  // A write creates its project; a list returns copies.
  await storage.writeFile({ root: 'projects', name: 'q' }, 'samples/sun', {
    rain: 3,
  })
  await storage.writeFile(p, 'components/moon', { id: 'id-moon' })
  await storage.deleteFile(p, 'components/sun')
  await storage.deleteFile(p, 'components/gone') // already gone: fine
  const listed = await storage.list()
  expect(listed.map((f) => `${f.root}/${f.name}`)).toEqual([
    'examples/sun-card',
    'projects/p',
    'projects/q',
  ])
  expect(listed[1]!.components).toEqual({ moon: { id: 'id-moon' } })
  expect(listed[2]).toEqual({
    ...files('projects', 'q'),
    samples: { sun: { rain: 3 } },
  })
  listed[1]!.components.moon = 'changed'
  expect((await storage.list())[1]!.components.moon).toEqual({ id: 'id-moon' })

  // Rename and delete; a taken name and a missing project are refused.
  await storage.renameProject(p, 'r')
  expect(
    (
      (await rejection(
        storage.renameProject({ root: 'projects', name: 'r' }, 'q'),
      )) as Error
    ).message,
  ).toBe('there is already a project named "q" in projects')
  await storage.deleteProject({ root: 'projects', name: 'q' })
  expect(((await rejection(storage.deleteProject(p))) as Error).message).toBe(
    'no project named "p" in projects',
  )
  expect((await storage.list()).map((f) => `${f.root}/${f.name}`)).toEqual([
    'examples/sun-card',
    'projects/r',
  ])

  // A read-only project refuses every change, with a StorageError.
  const example = { root: 'examples', name: 'sun-card' }
  for (const change of [
    storage.writeFile(example, 'components/sun', {}),
    storage.deleteFile(example, 'components/sun'),
    storage.renameProject(example, 'x'),
    storage.deleteProject(example),
    storage.writeFile({ root: 'examples', name: 'new' }, 'components/a', {}),
  ]) {
    const error = await rejection(change)
    expect(error).toBeInstanceOf(StorageError)
    expect((error as StorageError).message).toBe('examples is read-only')
  }

  // Every operation is recorded, and `refuse` can refuse any of them.
  const refusing = memoryStorage([], (call) =>
    call === 'list' ? 'no store' : undefined,
  )
  await expect(refusing.list()).rejects.toThrow('no store')
  expect(refusing.calls).toEqual(['list'])
})

interface Sent {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** A stub for fetch: records each request and answers with `reply`. */
function stubSend(
  reply: (sent: Sent) => { status: number; body?: unknown } = () => ({
    status: 200,
    body: {},
  }),
) {
  const sent: Sent[] = []
  const send: Send = (url, init) => {
    const request = { url, ...init }
    sent.push(request)
    const { status, body } = reply(request)
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () =>
        body === undefined
          ? Promise.reject(new SyntaxError('Unexpected end of JSON input'))
          : Promise.resolve(body),
    })
  }
  return { sent, send }
}

// A root and project name that need encoding, as the plugin decodes them.
const odd = { root: 'my projects', name: 'a/b' }
const encoded = '/__hackensack/projects/my%20projects/a%2Fb'

it('the dev-server storage sends the right URL, method, headers and body for each of its five operations', async () => {
  const listed = [
    {
      root: 'projects',
      name: 'p',
      readOnly: false,
      components: {},
      samples: {},
      problems: [],
    },
  ]
  const { sent, send } = stubSend((request) => ({
    status: 200,
    body: request.method === 'GET' ? listed : {},
  }))
  const storage = devServerStorage(send)

  expect(await storage.list()).toEqual(listed)
  await storage.writeFile(odd, 'components/sun', { format: 'x' })
  await storage.deleteFile(odd, 'samples/sun')
  await storage.renameProject(odd, 'c')
  await storage.deleteProject(odd)

  expect(sent).toEqual([
    // Listing changes nothing, so it carries no X-Hackensack header.
    { url: '/__hackensack/projects', method: 'GET', headers: {} },
    {
      url: `${encoded}/components/sun`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Hackensack': '1' },
      body: '{"format":"x"}',
    },
    {
      url: `${encoded}/samples/sun`,
      method: 'DELETE',
      headers: { 'X-Hackensack': '1' },
    },
    {
      url: `${encoded}/rename`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hackensack': '1' },
      body: '{"name":"c"}',
    },
    { url: encoded, method: 'DELETE', headers: { 'X-Hackensack': '1' } },
  ])
})

it('the dev-server storage rejects with the plugin error text, or the HTTP status when it gives none, for every operation, and passes a failed fetch through unchanged', async () => {
  const operations = (storage: ReturnType<typeof devServerStorage>) => [
    () => storage.list(),
    () => storage.writeFile(odd, 'components/sun', {}),
    () => storage.deleteFile(odd, 'components/sun'),
    () => storage.renameProject(odd, 'c'),
    () => storage.deleteProject(odd),
  ]

  // The plugin's own error text.
  const refusing = devServerStorage(
    stubSend(() => ({ status: 403, body: { error: 'examples is read-only' } }))
      .send,
  )
  for (const operation of operations(refusing)) {
    const error = await rejection(operation())
    expect(error).toBeInstanceOf(StorageError)
    expect((error as StorageError).message).toBe('examples is read-only')
  }

  // No JSON body: the HTTP status.
  const failing = devServerStorage(stubSend(() => ({ status: 500 })).send)
  for (const operation of operations(failing)) {
    const error = await rejection(operation())
    expect(error).toBeInstanceOf(StorageError)
    expect((error as StorageError).message).toBe('HTTP 500')
  }

  // A request that fails outright (no server) is passed on as it is, not a
  // StorageError, so the editor shows it unprefixed, as before #41.
  const offline = new TypeError('Failed to fetch')
  const unreachable = devServerStorage(() => Promise.reject(offline))
  for (const operation of operations(unreachable)) {
    expect(await rejection(operation())).toBe(offline)
  }
})

it('the dev-server storage list rejects when the response is not ok', async () => {
  // loadWorkspace falls back to the bundled examples when listing rejects; a
  // not-ok answer (a server that isn't the plugin, say) must reject too.
  const { send } = stubSend(() => ({ status: 404, body: [] }))
  await expect(devServerStorage(send).list()).rejects.toThrow('HTTP 404')
})

it('loadWorkspace returns the fallback projects, read-only and not savable, when the store cannot list', async () => {
  // The editor passes the bundled examples; any read-only project will do here.
  const fallback = [fromFiles(files('examples', 'sun-card', true))]
  const unreachable = memoryStorage([], () => 'no store')
  const workspace = await loadWorkspace(unreachable, fallback)
  expect(workspace).toEqual({ projects: fallback, canSave: false })
  expect(workspace.projects.every((p) => p.readOnly)).toBe(true)

  // A request that fails outright falls back the same way.
  const offline = devServerStorage(() =>
    Promise.reject(new TypeError('Failed to fetch')),
  )
  expect(await loadWorkspace(offline, fallback)).toEqual({
    projects: fallback,
    canSave: false,
  })
})

it('loadWorkspace returns the stored projects sorted and savable', async () => {
  const storage = memoryStorage([
    files('examples', 'b-example', true),
    files('projects', 'zed'),
    files('examples', 'a-example', true),
    files('projects', 'alpha'),
  ])
  const workspace = await loadWorkspace(storage, [])
  expect(workspace.canSave).toBe(true)
  // Writable projects first, then examples; each group by name.
  expect(
    workspace.projects.map((p) => `${p.root}/${p.name} ${p.readOnly}`),
  ).toEqual([
    'projects/alpha false',
    'projects/zed false',
    'examples/a-example true',
    'examples/b-example true',
  ])
  expect(storage.calls).toEqual(['list'])
})

it("only the dev-server storage names the plugin's URL and header or calls fetch", () => {
  // The editor's sources (src/, tests aside) talk to the dev server only
  // through devServerStorage.ts, and only the entry point picks that storage:
  // a desktop shell or file-access storage (#42) then replaces one file and
  // one line, not the editor.
  const repo = join(import.meta.dirname, '../..')
  const sources = readdirSync(join(repo, 'src'), {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith('.test.ts'),
    )
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return {
        file: relative(repo, path),
        text: readFileSync(path, 'utf8'),
      }
    })
  const filesWhere = (pattern: RegExp) =>
    sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file)

  // The scan found the editor (not an empty folder).
  expect(sources.map(({ file }) => file)).toContain('src/editor/App.tsx')
  expect(filesWhere(/__hackensack|X-Hackensack/)).toEqual([
    'src/editor/devServerStorage.ts',
  ])
  expect(filesWhere(/\bfetch\(/)).toEqual(['src/editor/devServerStorage.ts'])
  expect(filesWhere(/from ['"][^'"]*devServerStorage(\.ts)?['"]/)).toEqual([
    'src/main.tsx',
  ])
})
