import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listProjects, saveFile } from './projectStore.ts'
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
