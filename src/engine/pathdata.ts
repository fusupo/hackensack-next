// Text params with `{expression}` holes: a path's `d` ("M 0 0 L {w * 2} {h} Z")
// and, later, literal point lists. The text around the holes is kept exactly as
// written, so path data pasted from an icon works unchanged; only the holes
// are expressions. Holes are parsed and compiled once, at compile time.

import { compileExpr, expectNumber, formatNumber } from './expr.ts'
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
