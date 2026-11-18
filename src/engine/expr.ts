// Expressions: math.js, compiled once and evaluated against a scope Frame.

import { all, create } from 'mathjs'
import type { Frame } from './scope.ts'

const math = create(all, { matrix: 'Array' })

// Helpers for mapping data to visuals (#7). They must be imported here,
// before the block below replaces `import` itself. `override` keeps their
// meaning fixed even if a later math.js adds functions of the same name.
// Plain functions get no arity or type checks from math.js (a missing
// argument would silently give NaN), so each helper checks its own.
math.import(
  {
    remap: helper(
      'remap',
      ['value', 'fromMin', 'fromMax', 'toMin', 'toMax'],
      (value, fromMin, fromMax, toMin, toMax) => {
        const v = numArg('remap', 'value', value)
        const a = numArg('remap', 'fromMin', fromMin)
        const b = numArg('remap', 'fromMax', fromMax)
        const c = numArg('remap', 'toMin', toMin)
        const d = numArg('remap', 'toMax', toMax)
        if (a === b)
          throw new Error(
            `remap() needs fromMin and fromMax to differ, both are ${formatNumber(a)}`,
          )
        // No clamping: values outside fromMin..fromMax extrapolate.
        return c + ((v - a) * (d - c)) / (b - a)
      },
    ),
    clamp: helper('clamp', ['value', 'min', 'max'], (value, min, max) => {
      const v = numArg('clamp', 'value', value)
      const lo = numArg('clamp', 'min', min)
      const hi = numArg('clamp', 'max', max)
      if (lo > hi)
        throw new Error(
          `clamp() needs min <= max, got min ${formatNumber(lo)} and max ${formatNumber(hi)}`,
        )
      return Math.min(Math.max(v, lo), hi)
    }),
  },
  { override: true },
)

// Keep our own handle on compile(), then disable the functions math.js's
// security guidance says to remove when expressions come from documents
// (specs may be shared). `compileExpression` keeps working because math.js
// resolves its dependencies when the instance is created.
const compileExpression = math.compile
const disabled = (name: string) => () => {
  throw new Error(`${name}() is not available in expressions`)
}
math.import(
  {
    import: disabled('import'),
    createUnit: disabled('createUnit'),
    evaluate: disabled('evaluate'),
    parse: disabled('parse'),
    compile: disabled('compile'),
    simplify: disabled('simplify'),
    derivative: disabled('derivative'),
    resolve: disabled('resolve'),
  },
  { override: true },
)

/**
 * Wrap an expression helper so a call with the wrong number of arguments
 * names them, instead of running with some left undefined.
 */
function helper(
  name: string,
  argNames: readonly string[],
  fn: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
  return (...args) => {
    if (args.length !== argNames.length)
      throw new Error(
        `${name}() takes ${argNames.length} values (${argNames.join(', ')}), got ${args.length}`,
      )
    return fn(...args)
  }
}

/** A helper's number argument, with the helper and argument named on failure. */
function numArg(name: string, argName: string, value: unknown): number {
  try {
    return expectNumber(value)
  } catch (e) {
    throw new Error(`${name}() ${argName}: ${(e as Error).message}`)
  }
}

export type Evaluator = (scope: Frame) => unknown

/** Compile an expression once. Throws if it doesn't parse. */
export function compileExpr(source: string): Evaluator {
  const code = compileExpression(source)
  return (scope) => code.evaluate(scope)
}

/** An evaluator that always returns the same value. */
export function constant(value: unknown): Evaluator {
  return () => value
}

/**
 * math.js turns some scalar results into one-element lists (e.g. arithmetic
 * with `size(l)`). Where a single value is expected, unwrap them.
 */
export function unwrapSingle(value: unknown): unknown {
  let v = value
  while (Array.isArray(v) && v.length === 1) v = v[0]
  return v
}

export function expectNumber(value: unknown): number {
  const v = unwrapSingle(value)
  if (typeof v !== 'number')
    throw new Error(`expected a number, got ${describe(v)}`)
  if (!Number.isFinite(v)) throw new Error(`expected a finite number, got ${v}`)
  return v
}

export function expectString(value: unknown): string {
  const v = unwrapSingle(value)
  if (typeof v === 'string') return v
  if (typeof v === 'number') return formatNumber(v)
  throw new Error(`expected text, got ${describe(v)}`)
}

/** Numbers in SVG output: at most 6 decimals, no `-0`. */
export function formatNumber(n: number): string {
  const rounded = Math.round(n * 1e6) / 1e6
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

export function describe(value: unknown): string {
  if (value === undefined) return 'nothing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `a list of ${value.length}`
  if (typeof value === 'object') return 'an object'
  return `${typeof value} ${JSON.stringify(value)}`
}
