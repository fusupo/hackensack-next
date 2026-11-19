// What's in scope for a node's params, worked out from the spec (no
// rendering needed), for the inspector's scope panel. Mirrors the engine's
// rules (src/engine/render.ts): a node's params see the frames opened by its
// ancestors (each and grid bindings, exposed params) and the component's
// inputs. A node's own `each` or `grid` bindings and `expose` apply to its
// children, not to it. Only nodes that draw an element expose params.

import { isVariableName, NODE_TYPES } from '../engine/index.ts'
import type { ComponentSpec, NodeSpec } from '../engine/index.ts'
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

/**
 * The column, row and index names a grid binds, by the engine's rule
 * (src/engine/compile.ts): the names set on the node, unless one is invalid
 * or two are equal, in which case all three defaults.
 */
function gridNames(node: NodeSpec): [string, string, string] {
  const keys = ['col', 'row', 'index'] as const
  const defaults = keys.map((key) =>
    String(NODE_TYPES.grid!.params[key]!.default),
  ) as [string, string, string]
  const chosen = keys.map((key, i) => {
    const value = node.params?.[key]
    return value === undefined ? defaults[i]! : value
  })
  const valid = chosen.every(isVariableName)
  return valid && new Set(chosen).size === chosen.length
    ? (chosen as [string, string, string])
    : defaults
}

function preview(value: unknown): string {
  const text = JSON.stringify(value)
  if (text === undefined) return ''
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
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

  const frames: { label: string; vars: Omit<ScopeVar, 'shadowed'>[] }[] = []
  for (const id of ancestors) {
    const node = spec.nodes[id]!
    if (node.type === 'each') {
      const list = String(node.params?.list ?? '?')
      const as = typeof node.params?.as === 'string' ? node.params.as : 'd'
      const index =
        typeof node.params?.index === 'string' ? node.params.index : 'i'
      frames.push({
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
    // The engine binds exposed params only on nodes that draw an element,
    // and only entries with a valid name and a param the node sets.
    const exposed = NODE_TYPES[node.type]?.tag
      ? Object.entries(node.expose ?? {}).filter(
          ([name, param]) =>
            isVariableName(name) && Object.hasOwn(node.params ?? {}, param),
        )
      : []
    if (exposed.length > 0) {
      frames.push({
        label: `exposed by ${node.type} ${id}`,
        vars: exposed.map(([name, param]) => ({
          name,
          detail: `its ${param}: ${preview(node.params?.[param])}`,
        })),
      })
    }
  }
  frames.push({
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
    return { label: frame.label, vars }
  })
}
