// The `transform` param: SVG transform syntax whose arguments are expressions,
// e.g. "translate(sin(a) * 50, cos(a) * 50) rotate(360 - deg)".
// Parsed once at compile time; arguments are compiled like any expression.

import { compileExpr, expectNumber, formatNumber } from './expr.ts'
import type { Evaluator } from './expr.ts'
import type { Frame } from './scope.ts'

/** Allowed functions and how many arguments each accepts. */
const ARITY: Readonly<Record<string, readonly number[]>> = {
  translate: [1, 2],
  scale: [1, 2],
  rotate: [1, 3],
  skewX: [1],
  skewY: [1],
  matrix: [6],
}

export interface TransformStep {
  fn: string
  args: string[]
}

/** Split a transform string into steps. Throws with a readable message. */
export function parseTransform(source: string): TransformStep[] {
  const steps: TransformStep[] = []
  let pos = 0
  const skipSeparators = () => {
    while (pos < source.length && /[\s,]/.test(source[pos]!)) pos++
  }
  skipSeparators()
  while (pos < source.length) {
    const name = /^[A-Za-z]+/.exec(source.slice(pos))?.[0]
    if (!name)
      throw new Error(`expected a transform function at "${source.slice(pos)}"`)
    if (!(name in ARITY)) {
      throw new Error(
        `unknown transform function "${name}" (use ${Object.keys(ARITY).join(', ')})`,
      )
    }
    pos += name.length
    while (pos < source.length && /\s/.test(source[pos]!)) pos++
    if (source[pos] !== '(') throw new Error(`expected "(" after ${name}`)
    pos++

    // Read up to the matching ")", splitting arguments at top-level commas.
    const args: string[] = []
    let depth = 0
    let current = ''
    let closed = false
    let quote: string | undefined
    for (; pos < source.length; pos++) {
      const ch = source[pos]!
      if (quote) {
        current += ch
        if (ch === quote) quote = undefined
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '(' || ch === '[') {
        depth++
      } else if (ch === ')' || ch === ']') {
        if (depth === 0 && ch === ')') {
          closed = true
          pos++
          break
        }
        depth--
      } else if (ch === ',' && depth === 0) {
        args.push(current.trim())
        current = ''
        continue
      }
      current += ch
    }
    if (!closed) throw new Error(`missing ")" for ${name}`)
    if (current.trim() !== '' || args.length > 0) args.push(current.trim())
    if (args.some((a) => a === ''))
      throw new Error(`empty argument in ${name}()`)
    if (!ARITY[name]!.includes(args.length)) {
      throw new Error(
        `${name}() takes ${ARITY[name]!.join(' or ')} arguments, got ${args.length}`,
      )
    }
    steps.push({ fn: name, args })
    skipSeparators()
  }
  return steps
}

/** Compile a transform string to an evaluator producing the SVG attribute text. */
export function compileTransform(source: string): (scope: Frame) => string {
  const steps = parseTransform(source).map((step) => ({
    fn: step.fn,
    args: step.args.map((arg): Evaluator => compileExpr(arg)),
  }))
  return (scope) =>
    steps
      .map((step) => {
        const values = step.args.map((arg) =>
          formatNumber(expectNumber(arg(scope))),
        )
        return `${step.fn}(${values.join(', ')})`
      })
      .join(' ')
}
