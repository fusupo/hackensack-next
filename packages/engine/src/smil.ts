// The param kinds of SMIL animation nodes (#15): times in seconds, text with
// `{number}` holes (from, to, by, values, keyTimes), and the name of the
// attribute an `animate` changes. Each compiles once and throws a readable
// message for a value it can't compile; the returned function throws for a
// value it can't render, which is reported on the param and left out.

import {
  compileExpr,
  constant,
  describe,
  expectNumber,
  expectString,
  formatNumber,
} from './expr.ts'
import type { ParamDef } from './nodes.ts'
import { compileHoles } from './pathdata.ts'
import type { Frame } from './scope.ts'
import type { ParamValue } from './spec.ts'

type Evaluate = (scope: Frame) => { text: string; value: unknown }

/**
 * A time in seconds: a number, or a string read as an expression (a leading
 * `=` is allowed and changes nothing), written with an `s`.
 */
export function compileTime(raw: ParamValue, source: string): Evaluate {
  if (typeof raw === 'boolean') throw new Error('expected a number of seconds')
  const evaluate = typeof raw === 'number' ? constant(raw) : compileExpr(source)
  return (scope) => {
    const n = expectNumber(evaluate(scope))
    return { text: `${formatNumber(n)}s`, value: n }
  }
}

/** One item of an `=` value list: a number in the engine's format, or text. */
function item(value: unknown): string {
  if (typeof value === 'number') return formatNumber(expectNumber(value))
  if (typeof value === 'string') return value
  throw new Error(
    `expected numbers or text in the list, got ${describe(value)}`,
  )
}

/**
 * Text with `{expression}` holes that must give numbers, kept as written
 * around them (`"0 {cx} {cy}"`). A JSON number is written as a number. With
 * `=`, one expression giving text, a number, or a list: its items are joined
 * with `;`, and an item that is itself a list with spaces (`[[0, 0], [10, 5]]`
 * gives `0 0;10 5`).
 */
export function compileTemplate(
  raw: ParamValue,
  source: string,
  isExpression: boolean,
): Evaluate {
  if (typeof raw === 'boolean')
    throw new Error('expected text like "0; {r}; 0" or a number')
  if (typeof raw === 'number') {
    const text = formatNumber(raw)
    return () => ({ text, value: raw })
  }
  if (!isExpression) {
    const fill = compileHoles(source)
    return (scope) => {
      const text = fill(scope)
      return { text, value: text }
    }
  }
  const evaluate = compileExpr(source)
  return (scope) => {
    const value = evaluate(scope)
    if (!Array.isArray(value)) {
      const text = expectString(value)
      return { text, value }
    }
    const text = value
      .map((entry: unknown) =>
        Array.isArray(entry) ? entry.map(item).join(' ') : item(entry),
      )
      .join(';')
    return { text, value }
  }
}

const ATTRIBUTE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/

/**
 * Whether `name` is an attribute an animation may change: a plain attribute
 * name, never an event handler (`on…`) or a link (`href`, `xlink:href`).
 */
export function isAnimatableAttribute(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    ATTRIBUTE.test(name) &&
    !lower.startsWith('on') &&
    lower !== 'href' &&
    lower !== 'xlink:href'
  )
}

/** The checks a param's definition adds after evaluating: `options`, `positive`, and attribute names. */
export function withChecks(
  name: string,
  def: ParamDef,
  evaluate: Evaluate,
): Evaluate {
  const { options, positive, kind } = def
  if (!options && !positive && kind !== 'attribute') return evaluate
  return (scope) => {
    const result = evaluate(scope)
    if (positive && !((result.value as number) > 0))
      throw new Error(
        `${name} must be more than 0, got ${String(result.value)}`,
      )
    if (kind === 'attribute' && !isAnimatableAttribute(result.text))
      throw new Error(
        `${name} must be a plain attribute name, not "${result.text}"`,
      )
    if (options && !options.includes(result.text))
      throw new Error(
        `${name} must be one of ${options.join(', ')}, not "${result.text}"`,
      )
    return result
  }
}
