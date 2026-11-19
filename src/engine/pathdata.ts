// Text params with `{expression}` holes: a path's `d` ("M 0 0 L {w * 2} {h} Z")
// and a polygon's or polyline's literal `points`. The text around the holes is kept exactly as
// written, so path data pasted from an icon works unchanged; only the holes
// are expressions. Holes are parsed and compiled once, at compile time.

import { compileExpr, describe, expectNumber, formatNumber } from './expr.ts'
import type { Evaluator } from './expr.ts'
import type { Frame } from './scope.ts'

/** A piece of text with holes: literal text, or a hole's expression source. */
export type HolePiece =
  | { text: string }
  | { hole: string; /** 1-based position of the hole's `{` */ at: number }

/**
 * Split text into literal pieces and `{...}` holes. A hole runs to its
 * matching `}`: braces inside it nest (math.js objects like `{a: 1}`), and
 * braces inside a quoted string don't count. There is no escape for a literal
 * brace, since path data and point lists never contain one. Throws a readable
 * message, with the position, for an unclosed `{`, a stray `}` or an empty hole.
 */
export function scanHoles(source: string): HolePiece[] {
  const pieces: HolePiece[] = []
  let text = ''
  let pos = 0
  while (pos < source.length) {
    const ch = source[pos]!
    if (ch === '}') throw new Error(`unexpected "}" at position ${pos + 1}`)
    if (ch !== '{') {
      text += ch
      pos++
      continue
    }
    const start = pos
    let depth = 1
    let quote: string | undefined
    pos++
    for (; pos < source.length; pos++) {
      const c = source[pos]!
      if (quote) {
        if (c === '\\') pos++
        else if (c === quote) quote = undefined
        continue
      }
      if (c === '"' || c === "'") quote = c
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) break
    }
    if (depth !== 0) throw new Error(`unclosed "{" at position ${start + 1}`)
    const hole = source.slice(start + 1, pos)
    if (hole.trim() === '')
      throw new Error(`empty hole {} at position ${start + 1}`)
    if (text) pieces.push({ text })
    text = ''
    pieces.push({ hole, at: start + 1 })
    pos++
  }
  if (text) pieces.push({ text })
  return pieces
}

/**
 * Compile text with holes into a function giving the filled-in text. Each
 * hole must give a number (a one-element list is unwrapped), written with the
 * engine's number format; holes are substituted literally, with no separator
 * added. Throws, naming the hole, if a hole doesn't parse; the returned
 * function throws, naming the hole, if one fails or isn't a number.
 */
export function compileHoles(source: string): (scope: Frame) => string {
  const parts = scanHoles(source).map(
    (piece): string | { hole: string; evaluate: Evaluator } => {
      if ('text' in piece) return piece.text
      try {
        return { hole: piece.hole, evaluate: compileExpr(piece.hole) }
      } catch (e) {
        throw new Error(`{${piece.hole}}: ${(e as Error).message}`)
      }
    },
  )
  return (scope) =>
    parts
      .map((part) => {
        if (typeof part === 'string') return part
        try {
          return formatNumber(expectNumber(part.evaluate(scope)))
        } catch (e) {
          throw new Error(`{${part.hole}}: ${(e as Error).message}`)
        }
      })
      .join('')
}

/** The most points a polygon or polyline draws, as for a grid's cells. */
export const MAX_POINTS = 10_000

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/**
 * Whether a `points` string (without a leading `=`) is a literal point list
 * like "0,0 10,0 {w},{h}" rather than an expression like `pts`: once its
 * holes are set aside it holds only number characters, commas and spaces,
 * every token starts like a number, and there is a digit or a hole. Number
 * validity is checked later, so `10-5` is a literal that gets reported.
 */
export function isLiteralPoints(pieces: readonly HolePiece[]): boolean {
  const skeleton = pieces.map((p) => ('text' in p ? p.text : '0')).join('')
  if (!/^[0-9+\-.eE,\s]*$/.test(skeleton)) return false
  const tokens = skeleton.split(/[\s,]+/).filter((t) => t !== '')
  return (
    tokens.length > 0 &&
    tokens.every((t) => /^[0-9+\-.]/.test(t)) &&
    /[0-9]/.test(skeleton)
  )
}

/**
 * Compile a `points` param: an expression giving a list of [x, y] pairs, or a
 * literal point string with holes. A leading `=` (already removed from
 * `source`, with `isExpression` set) always means an expression. The result
 * is `x,y x,y` with each number in the engine's format; an empty list gives
 * no text, so nothing is drawn.
 */
export function compilePoints(
  source: string,
  isExpression: boolean,
): (scope: Frame) => { text: string; value: unknown } {
  if (!isExpression) {
    const pieces = scanHoles(source)
    if (isLiteralPoints(pieces)) {
      const fill = compileHoles(source)
      return (scope) => {
        const numbers = readLiteralPoints(fill(scope))
        return { text: pairsText(numbers), value: numbers }
      }
    }
  }
  const evaluate = compileExpr(source)
  return (scope) => {
    const value = evaluate(scope)
    return { text: pairsText(readPointList(value)), value }
  }
}

/** The numbers of a literal point string, in pairs. */
function readLiteralPoints(text: string): [number, number][] {
  const tokens = text.split(/[\s,]+/).filter((t) => t !== '')
  for (const token of tokens) {
    if (!NUMBER.test(token))
      throw new Error(
        `"${token}" isn't a number; separate numbers with a space or comma`,
      )
  }
  if (tokens.length % 2 !== 0)
    throw new Error(
      `expected pairs of numbers, got ${tokens.length} numbers; separate numbers with a space or comma`,
    )
  checkCount(tokens.length / 2)
  const pairs: [number, number][] = []
  for (let i = 0; i < tokens.length; i += 2)
    pairs.push([Number(tokens[i]), Number(tokens[i + 1])])
  return pairs
}

/**
 * A list of [x, y] pairs from an expression. The list itself is never
 * unwrapped, so a one-point list stays one point, and neither are its
 * entries, so a column like [[0], [10]] is reported rather than guessed at.
 */
function readPointList(value: unknown): [number, number][] {
  if (!Array.isArray(value))
    throw new Error(`expected a list of [x, y] pairs, got ${describe(value)}`)
  checkCount(value.length)
  return value.map((entry: unknown, i): [number, number] => {
    if (!Array.isArray(entry) || entry.length !== 2)
      throw new Error(`points[${i}]: expected [x, y], got ${describe(entry)}`)
    for (const n of entry) {
      if (typeof n !== 'number')
        throw new Error(
          `points[${i}]: expected [x, y] numbers, got ${describe(n)}`,
        )
      if (!Number.isFinite(n))
        throw new Error(`points[${i}]: expected finite numbers, got ${n}`)
    }
    return [entry[0] as number, entry[1] as number]
  })
}

function checkCount(count: number) {
  if (count > MAX_POINTS)
    throw new Error(`at most 10,000 points are drawn, got ${count}`)
}

const pairsText = (pairs: readonly [number, number][]) =>
  pairs.map(([x, y]) => `${formatNumber(x)},${formatNumber(y)}`).join(' ')
