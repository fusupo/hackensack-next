import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteFile,
  deleteProject,
  listProjects,
  renameProject,
  saveFile,
} from './projectStore.ts'
import type { StoreRoot } from './projectStore.ts'

let base: string
let roots: StoreRoot[]

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'hackensack-store-'))
  roots = [
    { name: 'examples', dir: join(base, 'examples'), readOnly: true },
    { name: 'projects', dir: join(base, 'projects'), readOnly: false },
  ]
  await mkdir(join(base, 'examples/demo/components'), { recursive: true })
  await mkdir(join(base, 'examples/demo/samples'), { recursive: true })
  await writeFile(join(base, 'examples/demo/components/a.json'), '{"root":"n"}')
  await writeFile(join(base, 'examples/demo/components/broken.json'), '{nope')
  await writeFile(join(base, 'examples/demo/samples/a.data.json'), '{"v":1}')
  await mkdir(join(base, 'examples/not-a-project'), { recursive: true })
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('project store', () => {
  it('lists projects with their files, reporting unreadable ones', async () => {
    expect(await listProjects(roots)).toEqual([
      {
        root: 'examples',
        name: 'demo',
        readOnly: true,
        components: { a: { root: 'n' } },
        samples: { a: { v: 1 } },
        problems: [expect.stringContaining('demo/components/broken.json')],
      },
    ])
  })

  it('saves into a writable root, creating folders', async () => {
    const path = await saveFile(roots, {
      root: 'projects',
      project: 'mine',
      kind: 'components',
      name: 'sun',
      content: { root: 'n0' },
    })
    expect(path).toBe(join(base, 'projects/mine/components/sun.json'))
    expect(await readFile(path, 'utf8')).toBe('{\n  "root": "n0"\n}\n')
    await saveFile(roots, {
      root: 'projects',
      project: 'mine',
      kind: 'samples',
      name: 'sun',
      content: { r: 2 },
    })
    const listed = (await listProjects(roots)).find((p) => p.name === 'mine')!
    expect(listed).toMatchObject({
      readOnly: false,
      components: { sun: { root: 'n0' } },
      samples: { sun: { r: 2 } },
    })
  })

  it('refuses read-only roots, bad names and non-object content', async () => {
    const save = (overrides: Partial<Parameters<typeof saveFile>[1]>) =>
      saveFile(roots, {
        root: 'projects',
        project: 'p',
        kind: 'components',
        name: 'c',
        content: {},
        ...overrides,
      })
    await expect(save({ root: 'examples' })).rejects.toMatchObject({
      status: 403,
    })
    await expect(save({ root: 'elsewhere' })).rejects.toMatchObject({
      status: 404,
    })
    await expect(save({ project: '../escape' })).rejects.toMatchObject({
      status: 400,
    })
    await expect(save({ name: 'a/b' })).rejects.toMatchObject({ status: 400 })
    await expect(save({ kind: 'secrets' })).rejects.toMatchObject({
      status: 400,
    })
    await expect(save({ content: [1, 2] })).rejects.toMatchObject({
      status: 400,
    })
  })
})

// --- #3: deleting files, renaming and deleting projects ----------------------

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

/** projects/mine with components a and b and a sample for a. */
async function mine(): Promise<string> {
  const dir = join(base, 'projects/mine')
  await mkdir(join(dir, 'components'), { recursive: true })
  await mkdir(join(dir, 'samples'), { recursive: true })
  await writeFile(join(dir, 'components/a.json'), '{}')
  await writeFile(join(dir, 'components/b.json'), '{}')
  await writeFile(join(dir, 'samples/a.data.json'), '{}')
  return dir
}

it('deletes a component file and its sample, and a missing file is not an error', async () => {
  const dir = await mine()
  const file = { root: 'projects', project: 'mine', name: 'a' }
  expect(await deleteFile(roots, { ...file, kind: 'components' })).toBe(
    join(dir, 'components/a.json'),
  )
  await deleteFile(roots, { ...file, kind: 'samples' })
  expect(await exists(join(dir, 'components/a.json'))).toBe(false)
  expect(await exists(join(dir, 'samples/a.data.json'))).toBe(false)
  expect(await exists(join(dir, 'components/b.json'))).toBe(true)
  // Again: already gone, still fine.
  await expect(
    deleteFile(roots, { ...file, kind: 'components' }),
  ).resolves.toBeDefined()
  await expect(
    deleteFile(roots, { ...file, project: 'nowhere', kind: 'components' }),
  ).resolves.toBeDefined()
})

it('refuses to delete a file in a read-only root or with a bad name or kind', async () => {
  await mine()
  const del = (overrides: Partial<Parameters<typeof deleteFile>[1]>) =>
    deleteFile(roots, {
      root: 'projects',
      project: 'mine',
      kind: 'components',
      name: 'b',
      ...overrides,
    })
  await expect(
    del({ root: 'examples', project: 'demo', name: 'a' }),
  ).rejects.toMatchObject({ status: 403 })
  expect(await exists(join(base, 'examples/demo/components/a.json'))).toBe(true)
  await expect(del({ root: 'elsewhere' })).rejects.toMatchObject({
    status: 404,
  })
  await expect(del({ name: '../b' })).rejects.toMatchObject({ status: 400 })
  await expect(del({ project: '..' })).rejects.toMatchObject({ status: 400 })
  await expect(del({ kind: 'secrets' })).rejects.toMatchObject({ status: 400 })
  expect(await exists(join(base, 'projects/mine/components/b.json'))).toBe(true)
})

it('renames a project folder and keeps its files', async () => {
  await mine()
  expect(
    await renameProject(roots, {
      root: 'projects',
      project: 'mine',
      to: 'yours',
    }),
  ).toBe(join(base, 'projects/yours'))
  expect(await exists(join(base, 'projects/mine'))).toBe(false)
  const listed = (await listProjects(roots)).find((p) => p.name === 'yours')!
  expect(Object.keys(listed.components)).toEqual(['a', 'b'])
  expect(Object.keys(listed.samples)).toEqual(['a'])
})

it('refuses a project rename onto an existing project, from a missing one, in a read-only root, or to a bad name', async () => {
  await mine()
  await mkdir(join(base, 'projects/other/components'), { recursive: true })
  const ren = (overrides: Partial<Parameters<typeof renameProject>[1]>) =>
    renameProject(roots, {
      root: 'projects',
      project: 'mine',
      to: 'fresh',
      ...overrides,
    })
  await expect(ren({ to: 'other' })).rejects.toMatchObject({ status: 409 })
  await expect(ren({ project: 'missing' })).rejects.toMatchObject({
    status: 404,
  })
  await expect(
    ren({ root: 'examples', project: 'demo' }),
  ).rejects.toMatchObject({ status: 403 })
  await expect(ren({ to: '../x' })).rejects.toMatchObject({ status: 400 })
  await expect(ren({ to: '' })).rejects.toMatchObject({ status: 400 })
  expect(await exists(join(base, 'projects/mine/components/a.json'))).toBe(true)
  expect(await exists(join(base, 'examples/demo'))).toBe(true)
  expect(await exists(join(base, 'x'))).toBe(false)
})

it('deletes a project folder with its components and samples', async () => {
  const dir = await mine()
  expect(
    await deleteProject(roots, { root: 'projects', project: 'mine' }),
  ).toBe(dir)
  expect(await exists(dir)).toBe(false)
  expect(await readdir(join(base, 'projects'))).toEqual([])
})

it('refuses a project delete with foreign files and leaves every component and sample file in place, and refuses read-only roots and bad names', async () => {
  const dir = await mine()
  const del = (overrides: Partial<Parameters<typeof deleteProject>[1]> = {}) =>
    deleteProject(roots, { root: 'projects', project: 'mine', ...overrides })
  const intact = async () => {
    for (const f of [
      'components/a.json',
      'components/b.json',
      'samples/a.data.json',
    ])
      expect(await exists(join(dir, f)), f).toBe(true)
  }

  // A stray file at the top, inside components/, or a folder in samples/.
  for (const stray of ['notes.txt', 'components/readme.md', 'samples/sub']) {
    if (stray === 'samples/sub') await mkdir(join(dir, stray))
    else await writeFile(join(dir, stray), 'mine')
    await expect(del()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(stray.split('/').pop()!) as unknown,
    })
    await intact()
    await rm(join(dir, stray), { recursive: true })
  }
  // A link is foreign too, even when it points at a folder.
  await symlink(join(base, 'examples'), join(dir, 'components/linked.json'))
  await expect(del()).rejects.toMatchObject({ status: 409 })
  await intact()
  expect(await exists(join(base, 'examples/demo/components/a.json'))).toBe(true)
  await rm(join(dir, 'components/linked.json'))

  await expect(
    del({ root: 'examples', project: 'demo' }),
  ).rejects.toMatchObject({ status: 403 })
  expect(await exists(join(base, 'examples/demo/components/a.json'))).toBe(true)
  await expect(del({ project: '..' })).rejects.toMatchObject({ status: 400 })
  await expect(del({ project: 'missing' })).rejects.toMatchObject({
    status: 404,
  })
  await intact()
})
