// What's in scope for a node's params, worked out from the spec (no
// rendering needed), for the inspector's scope panel. Mirrors the engine's
// rules (packages/engine/src/render.ts): a node's params see the frames opened
// by its ancestors (each and grid bindings, the names of vars nodes) and the
// component's inputs. A node's own `each` or `grid` bindings and `vars` names
// apply to its children, not to it. The names each node binds come from the
// engine (packages/engine/src/names.ts).

import { eachNames, gridNames, readVars } from '@hackensack/engine'
import type { ComponentSpec } from '@hackensack/engine'
import { parentOf } from './edit.ts'

export interface ScopeVar {
  name: string
  /** What it holds, in words. */
  detail: string
  /** Hidden by a nearer variable of the same name. */
  shadowed: boolean
}

export interface ScopeFrame {
  /** Where the variables come from, e.g. "each n2" or "inputs of spinner". */
  label: string
  vars: ScopeVar[]
}

function preview(value: unknown): string {
  const text = JSON.stringify(value)
  if (text === undefined) return ''
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

/** A scope frame with where it comes from, for code that needs to know. */
export interface SourcedFrame extends ScopeFrame {
  kind: 'inputs' | 'each' | 'grid' | 'vars'
}

/**
 * Frames visible to `nodeId`'s params, nearest first. `sample` supplies
 * current input values to show. Returns undefined for an unknown node.
 * Nodes not connected to the root only see the inputs.
 */
export function scopeAt(
  spec: ComponentSpec,
  component: string,
  nodeId: string,
  sample: Readonly<Record<string, unknown>> = {},
): ScopeFrame[] | undefined {
  return scopeFrames(spec, component, nodeId, sample)?.map(
    ({ label, vars }) => ({ label, vars }),
  )
}

/** `scopeAt`'s frames, each with its `kind`. */
export function scopeFrames(
  spec: ComponentSpec,
  component: string,
  nodeId: string,
  sample: Readonly<Record<string, unknown>> = {},
): SourcedFrame[] | undefined {
  if (!(nodeId in spec.nodes)) return undefined

  // Ancestors from the parent upwards.
  const ancestors: string[] = []
  const seen = new Set([nodeId])
  for (
    let up = parentOf(spec, nodeId)?.parent;
    up && !seen.has(up);
    up = parentOf(spec, up)?.parent
  ) {
    ancestors.push(up)
    seen.add(up)
  }

  const frames: {
    kind: SourcedFrame['kind']
    label: string
    vars: Omit<ScopeVar, 'shadowed'>[]
  }[] = []
  for (const id of ancestors) {
    const node = spec.nodes[id]!
    if (node.type === 'each') {
      const list = String(node.params?.list ?? '?')
      const [as, index] = eachNames(node)
      frames.push({
        kind: 'each',
        label: `each ${id}`,
        vars: [
          { name: as, detail: `one item of ${list}` },
          { name: index, detail: "that item's position, from 0" },
        ],
      })
    }
    if (node.type === 'grid') {
      const [col, row, index] = gridNames(node)
      frames.push({
        kind: 'grid',
        label: `grid ${id}`,
        vars: [
          { name: col, detail: 'its column, from 0' },
          { name: row, detail: 'its row, from 0' },
          {
            name: index,
            detail: 'its position, counting row by row from 0',
          },
        ],
      })
    }
    // The names the engine binds, in order, each with its expression.
    if (node.type === 'vars') {
      const entries = readVars(node).entries
      if (entries.length > 0)
        frames.push({
          kind: 'vars',
          label: `vars ${id}`,
          vars: entries.map(({ name, source }) => ({
            name,
            detail: source.length > 40 ? `${source.slice(0, 39)}…` : source,
          })),
        })
    }
  }
  frames.push({
    kind: 'inputs',
    label: `inputs of ${component}`,
    vars: Object.entries(spec.inputs ?? {}).map(([name, decl]) => {
      const parts: string[] = [decl.type ?? 'any']
      if (decl.inherit) parts.push('inherited')
      const value = name in sample ? sample[name] : decl.default
      const shown = preview(value)
      return {
        name,
        detail: shown ? `${parts.join(', ')} = ${shown}` : parts.join(', '),
      }
    }),
  })

  const nearer = new Set<string>()
  return frames.map((frame) => {
    const vars = frame.vars.map((v) => ({ ...v, shadowed: nearer.has(v.name) }))
    for (const v of frame.vars) nearer.add(v.name)
    return { kind: frame.kind, label: frame.label, vars }
  })
}
