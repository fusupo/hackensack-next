// Expressions: math.js, compiled once and evaluated against a scope Frame.

import { all, create } from 'mathjs'
import type { MathNode } from 'mathjs'
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
    mix: helper('mix', ['colorA', 'colorB', 't'], (colorA, colorB, t) => {
      const a = colorArg('mix', 'colorA', colorA)
      const b = colorArg('mix', 'colorB', colorB)
      // t is clamped: a channel pushed past 0 or 255 would only be clipped.
      const k = Math.min(Math.max(numArg('mix', 't', t), 0), 1)
      return (
        '#' +
        a
          .map((ca, i) =>
            Math.round(ca + (b[i]! - ca) * k)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
      )
    }),
  },
  { override: true },
)

// Keep our own handle on compile(), then disable the functions math.js's
// security guidance says to remove when expressions come from documents
// (specs may be shared). `compileExpression` keeps working because math.js
// resolves its dependencies when the instance is created.
const compileExpression = math.compile
// And on parse(), for reading which names an expression uses (exprNames).
const parseExpression = math.parse
const isSymbol = math.isSymbolNode
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
 * The constants math.js defines, which a `vars` name may not take (#50): a
 * name like `pi` would quietly change what every expression below it means.
 * Function names (`max`, `count`) are fine. Listed rather than read from the
 * math.js instance, which holds functions too; `expr.test.ts` checks each one
 * resolves.
 */
export const MATH_CONSTANTS: readonly string[] = [
  'e',
  'E',
  'pi',
  'PI',
  'i',
  'phi',
  'tau',
  'Infinity',
  'NaN',
  'null',
  'true',
  'false',
  'undefined',
  'LN2',
  'LN10',
  'LOG2E',
  'LOG10E',
  'SQRT1_2',
  'SQRT2',
  'version',
]

/** Whether `name` is a math.js constant, which a `vars` name can't be. */
export function isReservedName(name: string): boolean {
  return MATH_CONSTANTS.includes(name)
}

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

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** A helper's colour argument (`#rgb` or `#rrggbb`), as its three channels. */
function colorArg(name: string, argName: string, value: unknown): number[] {
  const v = unwrapSingle(value)
  if (typeof v !== 'string' || !HEX_COLOR.test(v))
    throw new Error(
      `${name}() ${argName}: expected a colour like '#rrggbb' or '#rgb', got ${describe(v)}`,
    )
  const digits = v.slice(1)
  const hex =
    digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

export type Evaluator = (scope: Frame) => unknown

/** Compile an expression once. Throws if it doesn't parse. */
export function compileExpr(source: string): Evaluator {
  const code = compileExpression(source)
  return (scope) => code.evaluate(scope)
}

/**
 * The symbols an expression reads, first seen first, each once: variables,
 * and also function names, constants (`pi`) and units, which callers that
 * want variables only filter by what is in scope. Nothing when it doesn't
 * parse.
 */
export function exprNames(source: string): string[] {
  let tree: MathNode
  try {
    tree = parseExpression(source)
  } catch {
    return []
  }
  const names: string[] = []
  tree.traverse((node) => {
    if (isSymbol(node) && !names.includes(node.name)) names.push(node.name)
  })
  return names
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
