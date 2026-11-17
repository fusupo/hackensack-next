// Reading and writing project folders on disk, for the dev-server plugin.
// Layout per PLAN.md: <root>/<project>/components/<name>.json and
// <root>/<project>/samples/<name>.data.json.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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

/** Write one component or sample file, creating folders as needed. */
export async function saveFile(
  roots: readonly StoreRoot[],
  request: SaveRequest,
): Promise<string> {
  const root = roots.find((r) => r.name === request.root)
  if (!root)
    throw new StoreError(404, `no project root named "${request.root}"`)
  if (root.readOnly) throw new StoreError(403, `${root.name} is read-only`)
  if (!NAME.test(request.project))
    throw new StoreError(400, `invalid project name "${request.project}"`)
  if (!NAME.test(request.name))
    throw new StoreError(400, `invalid file name "${request.name}"`)
  if (request.kind !== 'components' && request.kind !== 'samples') {
    throw new StoreError(400, `unknown file kind "${request.kind}"`)
  }
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
