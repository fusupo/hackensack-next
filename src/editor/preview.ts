// Make rendered output fit the preview pane.

import type { SvgNode } from '../engine/index.ts'

const NUMERIC = /^(\d+(?:\.\d+)?)(?:px)?$/

/**
 * A view box used when the output isn't wrapped in an <svg> (e.g. previewing a
 * component like `spoke` on its own). Components tend to draw around the
 * origin, so centre on it. A guess, not a rule: see PLAN.md's open question
 * about previewing inside a definition.
 */
const LOOSE_VIEWBOX = '-100 -100 200 200'

/**
 * Scale the picture to its pane: give the top-level <svg> a viewBox (from its
 * numeric width/height if it has none) and make it fill the available space.
 * Output without an <svg> root is wrapped in one.
 */
export function fitPreview(output: readonly SvgNode[]): SvgNode[] {
  if (output.length === 0) return []
  const root = output.length === 1 ? output[0] : undefined
  if (typeof root === 'object' && root.tag === 'svg') {
    const attrs = { ...root.attrs }
    const width = NUMERIC.exec(attrs.width ?? '')?.[1]
    const height = NUMERIC.exec(attrs.height ?? '')?.[1]
    if (!attrs.viewBox && width && height)
      attrs.viewBox = `0 0 ${width} ${height}`
    if (attrs.viewBox) {
      attrs.width = '100%'
      attrs.height = '100%'
    }
    return [{ ...root, attrs }]
  }
  return [
    {
      tag: 'svg',
      attrs: { viewBox: LOOSE_VIEWBOX, width: '100%', height: '100%' },
      children: [...output],
    },
  ]
}

const ANIMATION_TAGS = new Set(['animate', 'animateTransform'])

/** Whether the output holds an SMIL animation element anywhere (#15). */
export function hasAnimation(output: readonly SvgNode[]): boolean {
  return output.some(
    (node) =>
      typeof node === 'object' &&
      (ANIMATION_TAGS.has(node.tag) || hasAnimation(node.children)),
  )
}
