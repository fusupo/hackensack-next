// The engine's output: a plain SVG tree, serializable to a string.

export interface SvgElement {
  tag: string
  /** Attribute name -> value, in the order the spec listed the params. */
  attrs: Record<string, string>
  children: SvgNode[]
  /**
   * The ids of the instance nodes that drew this element, outermost first,
   * from the top-level component. Set only when rendering with
   * `trackOrigins` and only inside an instance; for the editor's preview.
   * Never serialized: `toSvgString` ignores it.
   */
  origin?: readonly string[]
}

/** An element, or a text node. */
export type SvgNode = SvgElement | string

const SVG_NS = 'http://www.w3.org/2000/svg'

const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;')

/**
 * Serialize nodes to SVG markup, indented two spaces per level. A top-level
 * `<svg>` gets the SVG namespace so the result is a valid standalone file.
 * Nothing to render gives an empty string.
 */
export function toSvgString(nodes: SvgNode | readonly SvgNode[]): string {
  const list = Array.isArray(nodes) ? nodes : [nodes as SvgNode]
  if (list.length === 0) return ''
  return list.map((node) => serialize(node, 0, true)).join('\n') + '\n'
}

function serialize(node: SvgNode, depth: number, topLevel: boolean): string {
  const indent = '  '.repeat(depth)
  if (typeof node === 'string') return indent + escapeText(node)

  const attrs = { ...node.attrs }
  if (topLevel && node.tag === 'svg' && !('xmlns' in attrs)) {
    Object.assign(attrs, { xmlns: SVG_NS })
  }
  const attrText = Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join('')
  const open = `${indent}<${node.tag}${attrText}`

  if (node.children.length === 0) return `${open} />`
  // Text-only content stays on one line: <text x="1">Hello</text>
  if (node.children.every((c) => typeof c === 'string')) {
    return `${open}>${node.children.map((c) => escapeText(c as string)).join('')}</${node.tag}>`
  }
  const inner = node.children
    .map((c) => serialize(c, depth + 1, false))
    .join('\n')
  return `${open}>\n${inner}\n${indent}</${node.tag}>`
}
