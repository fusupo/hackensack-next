// Reading and writing project folders on disk, for the dev-server plugin.
// Layout per PLAN.md: <root>/<project>/components/<name>.json and
// <root>/<project>/samples/<name>.data.json.

import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

export interface StoreRoot {
  /** Name the editor uses for this root, e.g. "examples" or "projects". */
  name: string
  /** Directory on disk. */
  dir: string
  readOnly: boolean
}

export interface ProjectFiles {
  root: string
  name: string
  readOnly: boolean
  components: Record<string, unknown>
  samples: Record<string, unknown>
  /** Files that couldn't be read, with the reason. */
  problems: string[]
}

export type FileKind = 'components' | 'samples'

/** Project, component and sample names: letters, digits, `-` and `_`. */
export const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** A failure with an HTTP status, so the plugin can answer with it. */
export class StoreError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const SUFFIX: Record<FileKind, string> = {
  components: '.json',
  samples: '.data.json',
}

async function entries(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch {
    return [] // missing directory: nothing there yet
  }
}

async function readJsonFiles(
  dir: string,
  suffix: string,
  problems: string[],
  label: string,
): Promise<Record<string, unknown>> {
  const files: Record<string, unknown> = {}
  for (const file of await entries(dir)) {
    if (!file.endsWith(suffix)) continue
    const name = file.slice(0, -suffix.length)
    if (!NAME.test(name)) continue
    try {
      files[name] = JSON.parse(await readFile(join(dir, file), 'utf8'))
    } catch (e) {
      problems.push(
        `${label}/${file}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  return files
}

/** Every project under every root, with all its component and sample files. */
export async function listProjects(
  roots: readonly StoreRoot[],
): Promise<ProjectFiles[]> {
  const projects: ProjectFiles[] = []
  for (const root of roots) {
    for (const name of await entries(root.dir)) {
      if (!NAME.test(name)) continue
      const problems: string[] = []
      const base = join(root.dir, name)
      const components = await readJsonFiles(
        join(base, 'components'),
        SUFFIX.components,
        problems,
        `${name}/components`,
      )
      const samples = await readJsonFiles(
        join(base, 'samples'),
        SUFFIX.samples,
        problems,
        `${name}/samples`,
      )
      if (Object.keys(components).length === 0 && problems.length === 0)
        continue // not a project
      projects.push({
        root: root.name,
        name,
        readOnly: root.readOnly,
        components,
        samples,
        problems,
      })
    }
  }
  return projects
}

export interface SaveRequest {
  root: string
  project: string
  kind: string
  name: string
  content: unknown
}

/** The writable root named `name`: 404 if there's none, 403 if it's read-only. */
function writableRoot(roots: readonly StoreRoot[], name: string): StoreRoot {
  const root = roots.find((r) => r.name === name)
  if (!root) throw new StoreError(404, `no project root named "${name}"`)
  if (root.readOnly) throw new StoreError(403, `${root.name} is read-only`)
  return root
}

/** Project, component and sample names can't contain `/`, `..` or anything else that leaves the root. */
function checkName(what: string, name: string): void {
  if (!NAME.test(name)) throw new StoreError(400, `invalid ${what} "${name}"`)
}

function checkKind(kind: string): asserts kind is FileKind {
  if (kind !== 'components' && kind !== 'samples')
    throw new StoreError(400, `unknown file kind "${kind}"`)
}

const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code

/** Write one component or sample file, creating folders as needed. */
export async function saveFile(
  roots: readonly StoreRoot[],
  request: SaveRequest,
): Promise<string> {
  const root = writableRoot(roots, request.root)
  checkName('project name', request.project)
  checkName('file name', request.name)
  checkKind(request.kind)
  const { content } = request
  if (
    typeof content !== 'object' ||
    content === null ||
    Array.isArray(content)
  ) {
    throw new StoreError(400, 'file content must be a JSON object')
  }
  const dir = join(root.dir, request.project, request.kind)
  await mkdir(dir, { recursive: true })
  const path = join(dir, request.name + SUFFIX[request.kind])
  await writeFile(path, JSON.stringify(content, null, 2) + '\n')
  return path
}

export interface FileRequest {
  root: string
  project: string
  kind: string
  name: string
}

/**
 * Delete one component or sample file. A file that is already gone is not an
 * error (a save that deletes may be retried). Returns the path.
 */
export async function deleteFile(
  roots: readonly StoreRoot[],
  request: FileRequest,
): Promise<string> {
  const root = writableRoot(roots, request.root)
  checkName('project name', request.project)
  checkName('file name', request.name)
  checkKind(request.kind)
  const path = join(
    root.dir,
    request.project,
    request.kind,
    request.name + SUFFIX[request.kind],
  )
  try {
    await unlink(path)
  } catch (e) {
    if (code(e) !== 'ENOENT') throw e
  }
  return path
}

/** The project folder, which must exist and be a real folder (not a link). */
async function projectDir(root: StoreRoot, project: string): Promise<string> {
  const dir = join(root.dir, project)
  try {
    if ((await lstat(dir)).isDirectory()) return dir
  } catch (e) {
    if (code(e) !== 'ENOENT') throw e
  }
  throw new StoreError(404, `no project named "${project}" in ${root.name}`)
}

/** Rename a project folder within its root. Returns the new path. */
export async function renameProject(
  roots: readonly StoreRoot[],
  request: { root: string; project: string; to: string },
): Promise<string> {
  const root = writableRoot(roots, request.root)
  checkName('project name', request.project)
  checkName('project name', request.to)
  const from = await projectDir(root, request.project)
  const to = join(root.dir, request.to)
  if (request.to === request.project) return to
  try {
    await lstat(to)
    throw new StoreError(
      409,
      `there is already a project named "${request.to}" in ${root.name}`,
    )
  } catch (e) {
    if (e instanceof StoreError) throw e
    if (code(e) !== 'ENOENT') throw e
  }
  await rename(from, to)
  return to
}

/**
 * Delete a project folder, but only when it holds nothing but what the editor
 * writes: `components/<name>.json` and `samples/<name>.data.json`. The whole
 * folder is checked before anything is removed, so a refused delete leaves
 * every file in place. Returns the deleted path.
 */
export async function deleteProject(
  roots: readonly StoreRoot[],
  request: { root: string; project: string },
): Promise<string> {
  const root = writableRoot(roots, request.root)
  checkName('project name', request.project)
  const dir = await projectDir(root, request.project)

  const files: string[] = []
  const folders: string[] = []
  const foreign: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const kind = entry.name
    if ((kind !== 'components' && kind !== 'samples') || !entry.isDirectory()) {
      foreign.push(kind)
      continue
    }
    const sub = join(dir, kind)
    folders.push(sub)
    for (const file of await readdir(sub, { withFileTypes: true })) {
      const suffix = SUFFIX[kind]
      const ok =
        file.isFile() &&
        file.name.endsWith(suffix) &&
        NAME.test(file.name.slice(0, -suffix.length))
      if (ok) files.push(join(sub, file.name))
      else foreign.push(`${kind}/${file.name}`)
    }
  }
  if (foreign.length > 0)
    throw new StoreError(
      409,
      `${request.project} holds files the editor didn't write (${foreign.join(', ')}); move them out first`,
    )

  for (const file of files) await unlink(file)
  for (const folder of folders) await rmdir(folder)
  await rmdir(dir)
  return dir
}
