// The storage seam (#41): the dev-server storage's requests and errors. Tests
// are top-level, so each one's name is exactly its title.

import { expect, it } from 'vitest'
import { devServerStorage } from './devServerStorage.ts'
import type { Send } from './devServerStorage.ts'
import { StorageError } from './storage.ts'

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
  const reason = (operation: () => Promise<unknown>) =>
    operation().then(
      () => 'no error',
      (e: unknown) => e,
    )

  // The plugin's own error text.
  const refusing = devServerStorage(
    stubSend(() => ({ status: 403, body: { error: 'examples is read-only' } }))
      .send,
  )
  for (const operation of operations(refusing)) {
    const error = await reason(operation)
    expect(error).toBeInstanceOf(StorageError)
    expect((error as StorageError).message).toBe('examples is read-only')
  }

  // No JSON body: the HTTP status.
  const failing = devServerStorage(stubSend(() => ({ status: 500 })).send)
  for (const operation of operations(failing)) {
    const error = await reason(operation)
    expect(error).toBeInstanceOf(StorageError)
    expect((error as StorageError).message).toBe('HTTP 500')
  }

  // A request that fails outright (no server) is passed on as it is, not a
  // StorageError, so the editor shows it unprefixed, as before #41.
  const offline = new TypeError('Failed to fetch')
  const unreachable = devServerStorage(() => Promise.reject(offline))
  for (const operation of operations(unreachable)) {
    expect(await reason(operation)).toBe(offline)
  }
})

it('the dev-server storage list rejects when the response is not ok', async () => {
  // loadWorkspace falls back to the bundled examples when listing rejects; a
  // not-ok answer (a server that isn't the plugin, say) must reject too.
  const { send } = stubSend(() => ({ status: 404, body: [] }))
  await expect(devServerStorage(send).list()).rejects.toThrow('HTTP 404')
})
