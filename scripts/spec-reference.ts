// Writes the spec format reference, docs/spec-reference.md (#61): what a
// person or an AI needs to write a Hackensack spec without reading PLAN.md.
// The node types and their params are generated from the engine's registry
// (NODE_TYPES), so the reference can't drift from the code; the rules for
// the spec as a whole are written once below, condensed from PLAN.md's
// *Spec format v4*.
//
//   npm run reference            # write docs/spec-reference.md
//   npm run reference -- --check # exit 1 when the committed file is stale
//
// Run it after any change to packages/engine/src/nodes.ts; a test fails
// when the committed file isn't the one this script makes.
//
// Runs with Node 24's type stripping (`node scripts/spec-reference.ts`).

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MATH_CONSTANTS,
  NODE_TYPES,
  OLDER_SPEC_FORMATS,
  SPEC_FORMAT,
} from '../packages/engine/src/index.ts'
import type { NodeTypeDef, ParamKind } from '../packages/engine/src/index.ts'

export const REFERENCE_FILE = join(
  import.meta.dirname,
  '..',
  'docs',
  'spec-reference.md',
)

/**
 * What a string means for each param kind. Typed by `ParamKind`, so a new
 * kind without a row is a type error.
 */
export const KIND_HELP: Readonly<Record<ParamKind, string>> = {
  number:
    'A JSON number, or a string that is an expression giving a number (`"r * 2"`).',
  length:
    'Like `number`, with an optional trailing `%` or `px` unit kept in the output (`"100%"`, `"d * 4px"`).',
  color:
    'A literal string (`"#ffffff"`, `"tomato"`); a leading `=` makes it an expression (`"=mix(\'#ffffff\', \'#555555\', cloud / 100)"`).',
  string: 'A literal string; a leading `=` makes it an expression giving text.',
  transform:
    'SVG transform syntax whose arguments are expressions: `"translate(sin(a) * 50, 0) rotate(45)"`. Functions: translate, scale, rotate, skewX, skewY, matrix.',
  expr: 'An expression (a string), evaluated as is: for `each`, it must give a list.',
  name: 'A literal variable name the node binds for its children (letters, digits and `_`, not starting with a digit).',
  path: 'SVG path data kept as written, with `{expression}` holes that must give numbers: `"M 0 0 L {w * 2} {h} Z"`. A leading `=` makes the whole value one expression giving text.',
  points:
    'An expression giving a list of `[x, y]` pairs (`"pts"`), or a literal point string with holes (`"0,0 {w},0 {w / 2},{h}"`). A leading `=` always makes it an expression.',
  time: 'Seconds: a number, or an expression giving one; written with an `s` (`"60 / wind"` with wind 20 gives `3s`).',
  template:
    'Text kept as written with `{expression}` holes that must give numbers (`"{r}; {r * 1.12}; {r}"`); a JSON number is written as a number. A leading `=` makes it one expression giving text, a number or a list (joined with `;`, an inner list with spaces).',
  attribute:
    'An attribute name the animation changes, read like `string`: a plain name (letters, digits, `-`, `_`, `:`, `.`), never an event handler (`on…`) or `href`.',
}

/**
 * What a node takes as children. Typed by the registry's `children`, so a
 * new value without a row is a type error.
 */
export const CHILDREN_HELP: Readonly<Record<NodeTypeDef['children'], string>> =
  {
    none: 'Takes no children.',
    many: 'Takes any nodes as children, drawn in order.',
    animation:
      'Takes only animation nodes (`animate`, `animateTransform`) as children; any other child is reported and left out.',
  }

/** Examples in examples/ that show each part of the format. */
export const EXAMPLE_INDEX: readonly { shows: string; example: string }[] = [
  { shows: '`each` over a list', example: 'spinner' },
  { shows: 'one shape per list value', example: 'rain-bars' },
  { shows: 'instances of one component', example: 'sun-card' },
  { shows: '`grid` (one icon per amount)', example: 'raindrops' },
  { shows: '`remap`, `clamp` and `mix`', example: 'weather-sky' },
  {
    shows: '`path`, `polygon` and `polyline`; icons as components',
    example: 'pictograms',
  },
  { shows: 'a whole picture from four inputs', example: 'weather-card' },
  { shows: 'a `vars` node naming a value once', example: 'weather-vars' },
  { shows: 'animation, and node labels', example: 'windmill' },
]

/** One param of a node type, as plain data. */
export interface ParamInfo {
  name: string
  kind: ParamKind
  group: string
  default?: string | number
  required: boolean
  options?: readonly string[]
  positive: boolean
}

/** One node type, as plain data. */
export interface NodeTypeInfo {
  type: string
  tag?: string
  children: NodeTypeDef['children']
  animation: boolean
  contentParam?: string
  fixed?: Readonly<Record<string, string>>
  params: ParamInfo[]
}

/** The registry as plain data, for the reference and later tools. */
export function describeRegistry(
  nodeTypes: Readonly<Record<string, NodeTypeDef>> = NODE_TYPES,
): NodeTypeInfo[] {
  return Object.entries(nodeTypes).map(([type, def]) => ({
    type,
    ...(def.tag !== undefined && { tag: def.tag }),
    children: def.children,
    animation: def.animation === true,
    ...(def.contentParam !== undefined && { contentParam: def.contentParam }),
    ...(def.fixed !== undefined && { fixed: def.fixed }),
    params: Object.entries(def.params).map(([name, p]) => ({
      name,
      kind: p.kind,
      group: p.group,
      ...(p.default !== undefined && { default: p.default }),
      required: p.required === true,
      ...(p.options !== undefined && { options: p.options }),
      positive: p.positive === true,
    })),
  }))
}

const code = (text: string | number) => `\`${text}\``

/** What a node type is, in a sentence, before its params. */
function nodeIntro(info: NodeTypeInfo): string {
  switch (info.type) {
    case 'each':
      return 'Repeats its children once per item of `list`, binding the item and its index (names set by `as` and `index`, defaults `d` and `i`). Draws no element of its own.'
    case 'grid':
      return 'Repeats its children over a whole-number `count`, row by row, `columns` to a row, each cell in its own `<g transform="translate(col * spacing, row * rowSpacing)">`. Binds the column, row and index (names set by `col`, `row` and `index`, defaults `col`, `row`, `n`). A fraction is rounded down.'
    case 'vars':
      return 'Names values for its children in its own `vars` field (not `params`): `"vars": { "half": "width / 2", "third": "half * 2 / 3" }`. Each value is an expression and may read the names before it, not itself or later ones. Names must be valid and not math.js constants. Draws no element.'
    case 'component':
      return "An instance of another definition: `ref` holds that definition's `id` (not its name). Its `params` are bindings for the definition's `inputs`: a string binding is literal for a `string` input and an expression otherwise. Draws the definition in place."
    default:
      return info.tag !== undefined
        ? `Draws an SVG ${code(`<${info.tag}>`)} element.`
        : 'Draws no element of its own.'
  }
}

function paramRow(p: ParamInfo, info: NodeTypeInfo): string {
  const notes: string[] = []
  if (p.positive) notes.push('must be more than 0')
  if (info.contentParam === p.name)
    notes.push("the element's text, not an attribute")
  const cells = [
    code(p.kind),
    p.default === undefined ? '' : code(p.default),
    p.required ? 'required' : '',
    (p.options ?? []).map(code).join(', '),
    notes.join('; '),
  ]
  return `| ${p.name} | ${cells.join(' | ')} |`
}

/** The section for one node type: a `### <type>` heading, then its params. */
function nodeSection(info: NodeTypeInfo): string {
  const lines = [`### ${info.type}`, '', nodeIntro(info), '']
  if (info.fixed)
    lines.push(
      `Always writes ${Object.entries(info.fixed)
        .map(([k, v]) => code(`${k}="${v}"`))
        .join(', ')} first.`,
      '',
    )
  if (info.animation)
    lines.push(
      'An animation node: put it under the shape or group it animates.',
      '',
    )
  lines.push(CHILDREN_HELP[info.children], '')
  if (info.params.length === 0) {
    lines.push(
      info.type === 'component'
        ? "Params: the bindings for the definition's inputs."
        : 'Params: none.',
    )
  } else {
    lines.push(
      '| param | kind | default | required | options | notes |',
      '|---|---|---|---|---|---|',
      ...info.params.map((p) => paramRow(p, info)),
    )
  }
  return lines.join('\n')
}

const RULES = `## A spec

A spec is one JSON file per component definition, \`components/<name>.json\` in a project folder; the file name is the component's name. Sample data for it goes in \`samples/<name>.data.json\`, a JSON object of input values.

\`\`\`json
{
  "format": "${SPEC_FORMAT}",
  "id": "5ad0c0de",
  "inputs": {
    "rain": { "type": "number", "default": 10 },
    "color": { "type": "string", "default": "#4a90d9" }
  },
  "root": "n0",
  "nodes": {
    "n0": { "type": "svg", "label": "card", "params": { "width": 140, "height": 80 }, "children": ["n1", "n2"] },
    "n1": { "type": "rect", "label": "sky", "params": { "width": 140, "height": 80, "fill": "#dfeefb" } },
    "n2": { "type": "g", "label": "rain", "params": { "transform": "translate(22, 22)" }, "children": ["n3"] },
    "n3": { "type": "grid", "label": "drops", "params": { "count": "rain / 5", "columns": 5, "spacing": 24 }, "children": ["n4"] },
    "n4": { "type": "circle", "label": "drop", "params": { "r": 5, "fill": "=color" } }
  }
}
\`\`\`

- **\`format\`** is \`"${SPEC_FORMAT}"\`. Older formats (${OLDER_SPEC_FORMATS.map(code).join(', ')}) are reported, never upgraded.
- **\`id\`**: 8 lowercase hex characters, unique in the project, made once when the definition is created and never changed. Instances refer to a definition by this id.
- **\`inputs\`**: what the data can set, by name. Each has a \`type\` (\`number\`, \`string\`, \`boolean\`, \`list\`, \`object\` or \`any\`), an optional \`default\`, and optional \`"inherit": true\` (an instance that doesn't bind it looks the name up where it is drawn). A value of the wrong type is reported and left unset; it doesn't fall back to the default.
- **\`root\`**: the id of the node drawn as the picture. A component used as a whole picture has an \`svg\` root; a part used inside others usually has a \`g\` root.
- **\`nodes\`** is a flat map from node id (\`n0\`, \`n1\`… by convention) to a node: \`type\` (below), optional \`label\`, \`params\`, and \`children\`.
- **\`children\`** is an ordered list of node ids, drawn in order (later on top). The nodes form a tree: every node has one parent, every id in \`children\` must exist in \`nodes\`, and nodes not reachable from \`root\` are reported and not drawn.
- **\`label\`** (any node): what the node stands for in the picture (\`"cloud"\`, \`"left blade"\`). Drawing ignores it; the editor shows it as the node's title and names problems by it. Text, or a number; a list, an object or a boolean is reported.
- **\`editor\`** (optional): node positions for the editor; drawing ignores it. Leave it out when writing a spec by hand.

### Values and expressions

- How a param's value is read depends on its kind (see *Param kinds*). JSON numbers and booleans are always literal.
- Expressions are [math.js](https://mathjs.org) expressions over the variables in scope: the component's inputs, names bound by \`each\`, \`grid\` and \`vars\` above the node, and nothing else. A node's params are never variables.
- Use \`count(l)\` for a list's length, not \`size(l)\`.
- Helpers for mapping data to visuals:
  - \`remap(value, fromMin, fromMax, toMin, toMax)\` maps linearly from one range to another (and extrapolates beyond it; wrap it in \`clamp\` for limits).
  - \`clamp(value, min, max)\` limits a value to \`min..max\`.
  - \`mix(colorA, colorB, t)\` blends two \`#rgb\` or \`#rrggbb\` colours, \`t\` from 0 to 1. In a colour param it needs \`=\`: \`"fill": "=mix('#ffffff', '#555555', cloud / 100)"\`.
- Expressions are sandboxed: no assignment, and math.js's \`import\`, \`evaluate\`, \`parse\`, \`compile\`, \`createUnit\`, \`simplify\`, \`derivative\` and \`resolve\` are disabled.
- These names are math.js constants and can't be bound by \`vars\`; don't use them as input names either: ${MATH_CONSTANTS.map(code).join(', ')}.
- Numbers in the output are rounded to 6 decimals.

### Components and scope

- A definition sees only its own inputs (and what \`each\`, \`grid\` and \`vars\` inside it bind). Pass values in through an instance's params; mark an input \`inherit\` to read the name from where the instance is drawn when it isn't bound.
- To reuse a shape, make it its own definition (a \`g\` root, inputs for what varies) and use instances of it.

### Problems

Problems are reported per node (and param), and the rest of the picture still draws. Run \`npm run check -- <projectDir> <component> --sample\` to list them, and \`npm run render -- <projectDir> <component> --sample --png <file.png>\` to see the picture.`

/** The whole reference, as Markdown. */
export function specReference(
  nodeTypes: Readonly<Record<string, NodeTypeDef>> = NODE_TYPES,
): string {
  const registry = describeRegistry(nodeTypes)
  const kinds = (Object.keys(KIND_HELP) as ParamKind[]).map(
    (kind) => `- ${code(kind)}: ${KIND_HELP[kind]}`,
  )
  const examples = EXAMPLE_INDEX.map(
    ({ shows, example }) => `- ${shows}: \`examples/${example}\``,
  )
  return [
    '# Hackensack spec format reference',
    '',
    "<!-- Generated by `npm run reference` (scripts/spec-reference.ts) from the node registry. Don't edit by hand. -->",
    '',
    `Spec format \`${SPEC_FORMAT}\`. A spec describes a picture as a tree of nodes whose params can read data; drawing it with data gives SVG. This reference is what you need to write one. PLAN.md's *Spec format v4* section has the full rules and why.`,
    '',
    RULES,
    '',
    '## Param kinds',
    '',
    ...kinds,
    '',
    '## Node types',
    '',
    `${registry.length} node types. Params left out aren't written; a default is what the browser (or the engine) uses then.`,
    '',
    registry.map(nodeSection).join('\n\n'),
    '',
    '## Examples',
    '',
    'Each folder in `examples/` is a project (`components/`, `samples/`, and the SVG it draws in `expected/`):',
    '',
    ...examples,
    '',
  ].join('\n')
}

/** The command line: returns the exit code. */
export function main(
  argv: string[],
  io: { out: (text: string) => void; err: (text: string) => void },
  file: string = REFERENCE_FILE,
): number {
  const text = specReference()
  if (argv.length === 1 && argv[0] === '--check') {
    let committed = ''
    try {
      committed = readFileSync(file, 'utf8')
    } catch {
      // A missing file is stale too.
    }
    if (committed === text) return 0
    io.err(
      'reference: docs/spec-reference.md is out of date; run npm run reference\n',
    )
    return 1
  }
  if (argv.length > 0) {
    io.err('reference: Usage: npm run reference [-- --check]\n')
    return 1
  }
  writeFileSync(file, text)
  io.out(`Wrote ${file}\n`)
  return 0
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
}
