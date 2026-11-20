// The player's core (#16): compiles a bundle once and renders it with data
// to SVG markup. No DOM: mount() and <hackensack-picture> put the markup in
// a page, and Node can use this directly.

import {
  compile,
  readBundle,
  toSvgString,
  withDefaults,
} from '@hackensack/engine'
import type { Bundle, Diagnostic, Program } from '@hackensack/engine'

/** Something wrong with a bundle, its definitions or its data. */
export interface Problem {
  /** `bundle`: the file itself; `compile`: a definition; `render`: with this data. */
  source: 'bundle' | 'compile' | 'render'
  message: string
  component?: string
  node?: string
  param?: string
  /** Render problems: the instance ids leading to the definition at fault. */
  path?: string[]
}

export interface Rendered {
  /** SVG markup, or '' when the bundle can't be read. */
  markup: string
  /** Every problem: the bundle's, its compile problems and this render's. */
  errors: Problem[]
}

export interface Renderer {
  /** Problems found before rendering: reading and compiling the bundle. */
  readonly problems: readonly Problem[]
  /** Renders with `data` laid over the bundle's default data. Never throws. */
  render(data?: Record<string, unknown>): Rendered
}

/**
 * Reads `input` (a parsed bundle) and compiles it once. Every `render`
 * reuses that compiled program. Never throws: an unreadable bundle gives a
 * renderer whose `render` returns no markup and the bundle's problems.
 */
export function createRenderer(input: unknown): Renderer {
  const read = readBundle(input)
  if (read.problems) {
    const problems = read.problems.map((p): Problem => ({
      source: 'bundle',
      message: p.message,
    }))
    return { problems, render: () => ({ markup: '', errors: [...problems] }) }
  }
  const bundle: Bundle = read.bundle
  let program: Program | undefined
  let problems: Problem[]
  try {
    program = compile(bundle.root, bundle.components)
    problems = program.errors.map((d) => fromDiagnostic('compile', d))
  } catch (error) {
    problems = [{ source: 'compile', message: messageOf(error) }]
  }
  return {
    problems,
    render(data) {
      if (!program) return { markup: '', errors: [...problems] }
      try {
        const { output, errors } = program.render(withDefaults(bundle, data))
        return {
          markup: toSvgString(output),
          errors: [
            ...problems,
            ...errors.map((d) => fromDiagnostic('render', d)),
          ],
        }
      } catch (error) {
        return {
          markup: '',
          errors: [
            ...problems,
            { source: 'render', message: messageOf(error) },
          ],
        }
      }
    },
  }
}

function fromDiagnostic(source: 'compile' | 'render', d: Diagnostic): Problem {
  const problem: Problem = {
    source,
    message: d.message,
    component: d.component,
  }
  if (d.node !== undefined) problem.node = d.node
  if (d.param !== undefined) problem.param = d.param
  if (d.path !== undefined && d.path.length > 0) problem.path = [...d.path]
  return problem
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One line for a person: `component › node › param: message`. */
export function describeProblem(problem: Problem): string {
  const where = [problem.component, problem.node, problem.param].filter(
    (part): part is string => part !== undefined && part !== '',
  )
  return where.length > 0
    ? `${where.join(' › ')}: ${problem.message}`
    : problem.message
}
