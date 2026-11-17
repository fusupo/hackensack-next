// The node type registry: what each node type renders as and which params it
// takes. The editor's param inspector will be generated from this (M3).

/**
 * How a param value is read:
 * - number, length, transform, expr: strings are expressions
 * - color, string: strings are literal unless they start with `=`
 * - name: a literal identifier (e.g. the variable an `each` binds)
 */
export type ParamKind =
  'number' | 'length' | 'color' | 'string' | 'transform' | 'expr' | 'name'

export interface ParamDef {
  kind: ParamKind
  /** Grouping for the editor. */
  group: 'geometry' | 'presentation' | 'text' | 'repeat' | 'document'
  /** Default shown in the editor. Not emitted: only params set in the spec are rendered. */
  default?: string | number
}

export interface NodeTypeDef {
  /** SVG element name. Absent for structural nodes (`each`, `component`). */
  tag?: string
  params: Readonly<Record<string, ParamDef>>
  children: 'none' | 'many'
  /** For `text`: the param rendered as the element's content, not an attribute. */
  contentParam?: string
}

const geometry = (kind: ParamKind = 'length'): ParamDef => ({
  kind,
  group: 'geometry',
})

const presentation: Record<string, ParamDef> = {
  fill: { kind: 'color', group: 'presentation' },
  stroke: { kind: 'color', group: 'presentation' },
  'stroke-width': { kind: 'number', group: 'presentation' },
  opacity: { kind: 'number', group: 'presentation' },
  transform: { kind: 'transform', group: 'presentation' },
}

export const NODE_TYPES: Readonly<Record<string, NodeTypeDef>> = {
  svg: {
    tag: 'svg',
    params: {
      width: { kind: 'length', group: 'document' },
      height: { kind: 'length', group: 'document' },
      viewBox: { kind: 'string', group: 'document' },
      preserveAspectRatio: { kind: 'string', group: 'document' },
    },
    children: 'many',
  },
  g: { tag: 'g', params: { ...presentation }, children: 'many' },
  rect: {
    tag: 'rect',
    params: {
      x: geometry(),
      y: geometry(),
      width: geometry(),
      height: geometry(),
      rx: geometry(),
      ry: geometry(),
      ...presentation,
    },
    children: 'none',
  },
  circle: {
    tag: 'circle',
    params: { cx: geometry(), cy: geometry(), r: geometry(), ...presentation },
    children: 'none',
  },
  ellipse: {
    tag: 'ellipse',
    params: {
      cx: geometry(),
      cy: geometry(),
      rx: geometry(),
      ry: geometry(),
      ...presentation,
    },
    children: 'none',
  },
  line: {
    tag: 'line',
    params: {
      x1: geometry(),
      y1: geometry(),
      x2: geometry(),
      y2: geometry(),
      ...presentation,
    },
    children: 'none',
  },
  text: {
    tag: 'text',
    params: {
      text: { kind: 'string', group: 'text' },
      x: geometry(),
      y: geometry(),
      'font-size': { kind: 'length', group: 'text' },
      'font-family': { kind: 'string', group: 'text' },
      'text-anchor': { kind: 'string', group: 'text' },
      ...presentation,
    },
    children: 'none',
    contentParam: 'text',
  },
  each: {
    params: {
      list: { kind: 'expr', group: 'repeat' },
      as: { kind: 'name', group: 'repeat', default: 'd' },
      index: { kind: 'name', group: 'repeat', default: 'i' },
    },
    children: 'many',
  },
  // Params of a component instance are bindings for the target's inputs;
  // they're checked against the definition, not this registry.
  component: { params: {}, children: 'none' },
}
