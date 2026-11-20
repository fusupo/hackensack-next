// The node type registry: what each node type renders as and which params it
// takes. The editor's param inspector will be generated from this (M3).

/**
 * How a param value is read:
 * - number, length, transform, expr: strings are expressions
 * - color, string: strings are literal unless they start with `=`
 * - name: a literal identifier (e.g. the variable an `each` binds)
 * - path: SVG path data, literal except for `{expression}` holes, which must
 *   give numbers; a leading `=` makes the whole string one expression
 * - points: an expression giving a list of [x, y] pairs, or a literal point
 *   string like "0,0 {w},0" (only numbers and holes); `=` forces an expression
 * - time: seconds, read like number and written with an `s` (`dur="2s"`)
 * - template: text with `{expression}` holes that must give numbers, like
 *   path; `=` makes it one expression giving text, a number or a list
 *   (joined with `;`, an inner list with spaces)
 * - attribute: an attribute name an animation changes, read like string; it
 *   must be a plain name, never an event handler or `href`
 */
export type ParamKind =
  | 'number'
  | 'length'
  | 'color'
  | 'string'
  | 'transform'
  | 'expr'
  | 'name'
  | 'path'
  | 'points'
  | 'time'
  | 'template'
  | 'attribute'

export interface ParamDef {
  kind: ParamKind
  /** Grouping for the editor. */
  group:
    | 'geometry'
    | 'presentation'
    | 'text'
    | 'repeat'
    | 'document'
    | 'animation'
    | 'timing'
  /** Default shown in the editor. Not emitted: only params set in the spec are rendered. */
  default?: string | number
  /** The only values the param takes, written or computed; anything else is reported. */
  options?: readonly string[]
  /** For `time`: the value must be more than 0. */
  positive?: true
  /** The node reports a problem when the param isn't set. */
  required?: true
}

export interface NodeTypeDef {
  /** SVG element name. Absent for structural nodes (`each`, `grid`, `component`). */
  tag?: string
  params: Readonly<Record<string, ParamDef>>
  /**
   * What the node takes as children: nothing, anything, or (shapes) animation
   * nodes only. Ask `takesChildren` and `childProblem` rather than comparing.
   */
  children: 'none' | 'many' | 'animation'
  /** For `text`: the param rendered as the element's content, not an attribute. */
  contentParam?: string
  /** An SMIL animation node (`animate`, `animateTransform`). */
  animation?: true
  /** Attributes always written first, which aren't params. */
  fixed?: Readonly<Record<string, string>>
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

// For shapes drawn from path data and point lists: `evenodd` cut-outs in
// icons, and round caps and joins for line pictograms.
const strokeStyle: Record<string, ParamDef> = {
  'fill-rule': { kind: 'string', group: 'presentation' },
  'stroke-linecap': { kind: 'string', group: 'presentation' },
  'stroke-linejoin': { kind: 'string', group: 'presentation' },
}

// The params `animate` and `animateTransform` share: the values to animate
// through, and the timing.
const animationValues: Record<string, ParamDef> = {
  from: { kind: 'template', group: 'animation' },
  to: { kind: 'template', group: 'animation' },
  by: { kind: 'template', group: 'animation' },
  values: { kind: 'template', group: 'animation' },
  keyTimes: { kind: 'template', group: 'animation' },
  calcMode: {
    kind: 'string',
    group: 'animation',
    default: 'linear',
    options: ['linear', 'discrete', 'paced'],
  },
  additive: {
    kind: 'string',
    group: 'animation',
    default: 'replace',
    options: ['replace', 'sum'],
  },
}
const timing: Record<string, ParamDef> = {
  begin: { kind: 'time', group: 'timing', default: 0 },
  dur: { kind: 'time', group: 'timing', positive: true, required: true },
  repeatCount: { kind: 'string', group: 'timing', default: 1 },
  // SMIL's fill: whether the animation's end value stays.
  fill: {
    kind: 'string',
    group: 'timing',
    default: 'remove',
    options: ['freeze', 'remove'],
  },
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
    children: 'animation',
  },
  circle: {
    tag: 'circle',
    params: { cx: geometry(), cy: geometry(), r: geometry(), ...presentation },
    children: 'animation',
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
    children: 'animation',
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
    children: 'animation',
  },
  path: {
    tag: 'path',
    params: {
      d: { kind: 'path', group: 'geometry' },
      ...presentation,
      ...strokeStyle,
    },
    children: 'animation',
  },
  polygon: {
    tag: 'polygon',
    params: {
      points: { kind: 'points', group: 'geometry' },
      ...presentation,
      ...strokeStyle,
    },
    children: 'animation',
  },
  polyline: {
    tag: 'polyline',
    params: {
      points: { kind: 'points', group: 'geometry' },
      ...presentation,
      ...strokeStyle,
    },
    children: 'animation',
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
    children: 'animation',
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
  // Repeats its children once per whole cell of a count, row by row, each cell
  // in its own <g transform="translate(...)">. `rowSpacing` unset means the
  // same as `spacing`.
  grid: {
    params: {
      count: { kind: 'number', group: 'repeat' },
      columns: { kind: 'number', group: 'repeat', default: 5 },
      spacing: { kind: 'number', group: 'repeat', default: 20 },
      rowSpacing: { kind: 'number', group: 'repeat' },
      col: { kind: 'name', group: 'repeat', default: 'col' },
      row: { kind: 'name', group: 'repeat', default: 'row' },
      index: { kind: 'name', group: 'repeat', default: 'n' },
    },
    children: 'many',
  },
  // SMIL animation of the element it sits in (#15).
  animate: {
    tag: 'animate',
    params: {
      attributeName: { kind: 'attribute', group: 'animation', required: true },
      ...animationValues,
      ...timing,
    },
    children: 'none',
    animation: true,
  },
  animateTransform: {
    tag: 'animateTransform',
    params: {
      type: {
        kind: 'string',
        group: 'animation',
        default: 'translate',
        options: ['translate', 'scale', 'rotate', 'skewX', 'skewY'],
      },
      ...animationValues,
      ...timing,
    },
    children: 'none',
    animation: true,
    fixed: { attributeName: 'transform' },
  },
  // Params of a component instance are bindings for the target's inputs;
  // they're checked against the definition, not this registry.
  component: { params: {}, children: 'none' },
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

/** Whether a node of this type takes children at all. */
export function takesChildren(def: NodeTypeDef | undefined): boolean {
  return def !== undefined && def.children !== 'none'
}

/**
 * Why a node of type `childType` can't be a child of one of `parentType`, or
 * nothing when it can. Shapes take animation nodes only (not `each`, `grid`
 * or instances, so what a shape holds never depends on data). The compiler
 * and the editor's connect rules both ask this, so they can't disagree. An
 * unknown parent type is someone else's problem: nothing.
 */
export function childProblem(
  parentType: string,
  childType: string,
): string | undefined {
  const parent = Object.hasOwn(NODE_TYPES, parentType)
    ? NODE_TYPES[parentType]
    : undefined
  if (!parent) return undefined
  if (parent.children === 'none')
    return `${article(parentType)} ${parentType} node can't have children`
  if (parent.children === 'many') return undefined
  const child = Object.hasOwn(NODE_TYPES, childType)
    ? NODE_TYPES[childType]
    : undefined
  if (child?.animation) return undefined
  return `${article(parentType)} ${parentType} node only takes animation nodes (animate, animateTransform), not ${article(childType)} ${childType}`
}

/**
 * Whether a node of this type binds its `expose` entries: only nodes that
 * draw an element and can have children to read them, so not animation nodes.
 */
export function exposes(def: NodeTypeDef | undefined): boolean {
  return Boolean(def?.tag) && !def?.animation
}
