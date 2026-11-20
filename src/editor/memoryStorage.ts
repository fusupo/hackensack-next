// A ProjectStorage held in memory, for tests: it keeps projects in a map,
// records every operation in order and can be told to refuse some. It follows
// the dev-server store's rules where tests can tell: a read-only project
// refuses changes, a write creates its project, deleting a missing file is
// fine, and renaming onto a taken name or a missing project is refused.

import { projectKey } from './projects.ts'
import type { ProjectFiles } from './projects.ts'
import { StorageError } from './storage.ts'
import type { ProjectRef, ProjectStorage } from './storage.ts'

export interface MemoryStorage extends ProjectStorage {
  /**
   * Every operation asked for, in order, refused or not: `list`,
   * `write projects/p components/sun`, `delete projects/p samples/sun`,
   * `rename projects/p q`, `deleteProject projects/p`.
   */
  readonly calls: string[]
}

/**
 * `refuse` is asked about each operation (its `calls` entry) before it is
 * carried out; a reason refuses it with a StorageError of that reason.
 */
export function memoryStorage(
  initial: readonly ProjectFiles[] = [],
  refuse: (call: string) => string | undefined = () => undefined,
): MemoryStorage {
  const projects = new Map(
    initial.map((p) => [projectKey(p), structuredClone(p)]),
  )
  const calls: string[] = []
  const ask = (call: string) => {
    calls.push(call)
    const reason = refuse(call)
    if (reason !== undefined) throw new StorageError(reason)
  }
  const writable = (ref: ProjectRef) => {
    const readOnly =
      projects.get(projectKey(ref))?.readOnly ??
      [...projects.values()].some((p) => p.root === ref.root && p.readOnly)
    if (readOnly) throw new StorageError(`${ref.root} is read-only`)
  }
  const existing = (ref: ProjectRef) => {
    const project = projects.get(projectKey(ref))
    if (!project)
      throw new StorageError(`no project named "${ref.name}" in ${ref.root}`)
    return project
  }
  const split = (file: string) =>
    file.split('/') as ['components' | 'samples', string]

  return {
    calls,
    async list() {
      ask('list')
      return [...projects.values()].map((p) => structuredClone(p))
    },
    async writeFile(ref, file, content) {
      ask(`write ${projectKey(ref)} ${file}`)
      writable(ref)
      let project = projects.get(projectKey(ref))
      if (!project) {
        project = {
          root: ref.root,
          name: ref.name,
          readOnly: false,
          components: {},
          samples: {},
          problems: [],
        }
        projects.set(projectKey(ref), project)
      }
      const [kind, name] = split(file)
      project[kind][name] = structuredClone(content)
    },
    async deleteFile(ref, file) {
      ask(`delete ${projectKey(ref)} ${file}`)
      writable(ref)
      const project = projects.get(projectKey(ref))
      if (!project) return
      const [kind, name] = split(file)
      delete project[kind][name]
    },
    async renameProject(ref, name) {
      ask(`rename ${projectKey(ref)} ${name}`)
      writable(ref)
      const project = existing(ref)
      if (name === ref.name) return
      const to = { root: ref.root, name }
      if (projects.has(projectKey(to)))
        throw new StorageError(
          `there is already a project named "${name}" in ${ref.root}`,
        )
      projects.delete(projectKey(ref))
      projects.set(projectKey(to), { ...project, name })
    },
    async deleteProject(ref) {
      ask(`deleteProject ${projectKey(ref)}`)
      writable(ref)
      existing(ref)
      projects.delete(projectKey(ref))
    },
  }
}
