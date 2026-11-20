// Highlight what the entered instance drew in the in-context preview (#4).
//
// The preview renders the first crumb's component with `trackOrigins`, so
// every element drawn inside an instance carries `origin`, the path of
// instance ids that drew it. The trail's `via`s name the chain of instances
// you entered through; an element belongs to that chain when its origin
// starts with it. Path ids name instance nodes, not repetitions, so every
// drawing of an instance inside an `each` matches.

import type { SvgElement, SvgNode } from '@hackensack/engine'
import type { Trail } from './trail.ts'

/** The instance ids entered through, outermost first. Empty at the top level. */
export function enteredChain(trail: Trail): string[] {
  return trail.slice(1).map((c) => c.via ?? '')
}

export interface Marked {
  output: SvgNode[]
  /** How many elements the entered instance drew (topmost ones only). */
  drawn: number
}

/**
 * Mark the topmost elements drawn by the instance chain `chain` with
 * `data-entered`, and the topmost elements that hold none of them with
 * `data-dimmed`. Elements holding an entered one are left as they are, and
 * nothing below a marked element is marked again: opacity is inherited
 * (dimming an ancestor would dim the entered element too) and multiplies
 * (dimming a dimmed group's children would fade them twice).
 *
 * When nothing matches (or the chain is empty), the output comes back
 * unchanged with `drawn` 0. Only these two fixed attribute names, with a
 * constant value, are ever added, so the output stays safe to serialize and
 * insert as markup.
 */
export function markEntered(
  output: readonly SvgNode[],
  chain: readonly string[],
): Marked {
  if (chain.length === 0) return { output: [...output], drawn: 0 }
  const isEntered = (origin: readonly string[] | undefined): boolean =>
    origin !== undefined &&
    origin.length >= chain.length &&
    chain.every((id, i) => origin[i] === id)

  const walk = (node: SvgNode): { node: SvgNode; drawn: number } => {
    if (typeof node === 'string') return { node, drawn: 0 }
    if (isEntered(node.origin))
      return { node: withFlag(node, 'data-entered'), drawn: 1 }
    const children = node.children.map((child) => walk(child))
    const drawn = children.reduce((sum, c) => sum + c.drawn, 0)
    if (drawn === 0) return { node: withFlag(node, 'data-dimmed'), drawn: 0 }
    return { node: { ...node, children: children.map((c) => c.node) }, drawn }
  }

  const results = output.map((node) => walk(node))
  const drawn = results.reduce((sum, r) => sum + r.drawn, 0)
  if (drawn === 0) return { output: [...output], drawn: 0 }
  return { output: results.map((r) => r.node), drawn }
}

function withFlag(
  node: SvgElement,
  flag: 'data-entered' | 'data-dimmed',
): SvgElement {
  return { ...node, attrs: { ...node.attrs, [flag]: 'true' } }
}
