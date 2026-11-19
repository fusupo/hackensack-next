// What a node's params read and what a node binds, worked out from the spec
// without compiling it. The rules follow compile.ts exactly: which params are
// expressions (compileParam and the node registry), how an instance's
// bindings are read (bindingKind), and which names `each`, `grid` and
// `expose` bind. The editor's scope panel and Collapse to component (#14)
// use these, so they never invent names the engine doesn't bind.

import { bindingKind, isVariableName } from './compile.ts'
import { compileExpr, exprNames } from './expr.ts'
import { NODE_TYPES } from './nodes.ts'
import type { ParamKind } from './nodes.ts'
import { isLiteralPoints, scanHoles } from './pathdata.ts'
import type { HolePiece } from './pathdata.ts'
import type { InputDecl, NodeSpec, ParamValue } from './spec.ts'
import { parseTransform } from './transform.ts'

/** The symbols an expression reads; throws, as compile does, if it doesn't parse. */
function read(source: string): string[] {
  compileExpr(source)
  return exprNames(source)
}

const holeNames = (pieces: readonly HolePiece[]) =>
  pieces.flatMap((piece) => ('hole' in piece ? read(piece.hole) : []))

/**
 * The symbols one param value reads, read as `kind` the way compileParam
 * reads it. A value that doesn't compile reads nothing (compile reports it).
 */
function valueNames(kind: ParamKind, raw: ParamValue): string[] {
  // Numbers and booleans are literals, whatever the kind.
  if (typeof raw !== 'string') return []
  const isExpression = raw.startsWith('=')
  const source = (isExpression ? raw.slice(1) : raw).trim()
  try {
    switch (kind) {
      case 'number':
      case 'expr':
        return read(source)
      case 'length':
        // A trailing % or px is a unit, not part of the expression.
        return read(/^(.*?)\s*(%|px)?$/s.exec(source)?.[1] ?? '')
      case 'color':
      case 'string':
        return isExpression ? read(source) : []
      case 'transform':
        return parseTransform(source).flatMap((step) =>
          step.args.flatMap(read),
        )
      case 'path':
        return isExpression ? read(source) : holeNames(scanHoles(source))
      case 'points': {
        if (!isExpression) {
          const pieces = scanHoles(source)
          if (isLiteralPoints(pieces)) return holeNames(pieces)
        }
        return read(source)
      }
      case 'name':
        return []
    }
  } catch {
    return []
  }
}

/**
 * The symbols `node`'s own params read, first seen first, each once: every
 * param the engine compiles, by its kind. An instance's params are bindings,
 * read by the type of the input they bind in `targetInputs` (its
 * definition's inputs); params its definition doesn't declare, or all of
 * them when the definition is unknown, aren't compiled and read nothing.
 * Function names, constants and units are included; filter by scope.
 */
export function paramNames(
  node: NodeSpec,
  targetInputs?: Readonly<Record<string, InputDecl>>,
): string[] {
  const def = Object.hasOwn(NODE_TYPES, node.type)
    ? NODE_TYPES[node.type]
    : undefined
  if (!def) return []
  const names: string[] = []
  for (const [name, value] of Object.entries(node.params ?? {})) {
    let kind: ParamKind | undefined
    if (node.type === 'component') {
      const decl =
        targetInputs && Object.hasOwn(targetInputs, name)
          ? targetInputs[name]
          : undefined
      kind = decl && bindingKind(decl)
    } else if (Object.hasOwn(def.params, name)) kind = def.params[name]!.kind
    if (!kind) continue
    for (const read of valueNames(kind, value))
      if (!names.includes(read)) names.push(read)
  }
  return names
}

/** A `name` param's value when set and valid, else `fallback` (compile's readName). */
const nameOr = (value: ParamValue | undefined, fallback: string) =>
  isVariableName(value) ? value : fallback

/**
 * The item and index names an `each` binds: each one as set, or its own
 * default (`d`, `i`) when unset or invalid.
 */
export function eachNames(node: NodeSpec): [string, string] {
  return [nameOr(node.params?.as, 'd'), nameOr(node.params?.index, 'i')]
}

/**
 * The column, row and index names a grid binds: the names set on the node,
 * unless one is invalid or two are equal, in which case all three defaults
 * (`col`, `row`, `n`).
 */
export function gridNames(node: NodeSpec): [string, string, string] {
  const keys = ['col', 'row', 'index'] as const
  const defaults = keys.map((key) =>
    String(NODE_TYPES.grid!.params[key]!.default),
  ) as [string, string, string]
  const chosen = keys.map((key, i) => node.params?.[key] ?? defaults[i]!)
  return chosen.every(isVariableName) && new Set(chosen).size === chosen.length
    ? (chosen as [string, string, string])
    : defaults
}

/**
 * The variables a node's `expose` binds for its subtree: only on nodes that
 * draw an element, and only entries with a valid name and a param the node
 * sets.
 */
export function exposedNames(node: NodeSpec): { name: string; param: string }[] {
  const def = Object.hasOwn(NODE_TYPES, node.type)
    ? NODE_TYPES[node.type]
    : undefined
  if (!def?.tag) return []
  return Object.entries(node.expose ?? {})
    .filter(
      ([name, param]) =>
        isVariableName(name) && Object.hasOwn(node.params ?? {}, param),
    )
    .map(([name, param]) => ({ name, param }))
}
