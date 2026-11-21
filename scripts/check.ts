// Checks a component of a project folder (#61): compiles it, draws it with
// its data, and prints every problem the engine reports, one per line:
//
//   npm run check -- <projectDir> <component> [--sample | --data <file>]
//
//   sun-card: n8 (cloud) fill: expected a color, got a number
//   part: p1 (bad dot) r: Undefined symbol howMany [via n4]
//
// A line names the definition the problem is in, the node (with its label
// when it has one), the param and the message; a problem inside an instance
// ends with the instance path from the checked component. Nothing is printed
// and the exit code is 0 when there are no problems; otherwise it is 1. A
// usage error, or a project or file that can't be read, is one line on
// stderr and exit 1.
//
// Runs with Node 24's type stripping (`node scripts/check.ts`). It imports
// the engine by path, so it needs no workspace link in node_modules.

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compile,
  nodeLabel,
  toSvgString,
} from '../packages/engine/src/index.ts'
import type { Diagnostic, Library } from '../packages/engine/src/index.ts'
import { loadData, loadLibrary, requireComponent } from './project.ts'
import type { DataSource } from './project.ts'

/** What drawing a component gave: its SVG and its problems, as lines. */
export interface Drawn {
  svg: string
  problems: string[]
}

/** Compiles and draws `component` from `projectDir`. Throws on a project that can't be read. */
export function drawProject(
  projectDir: string,
  component: string,
  source: DataSource = {},
): Drawn {
  const library = loadLibrary(projectDir)
  requireComponent(library, projectDir, component)
  const data = loadData(projectDir, component, source)
  const program = compile(component, library)
  const { output, errors } = program.render(data ?? {})
  return {
    svg: toSvgString(output),
    problems: [...program.errors, ...errors].map((d) =>
      describeProblem(d, library),
    ),
  }
}

/** Every problem of `component`, one line each; empty when there are none. */
export function checkProject(
  projectDir: string,
  component: string,
  source: DataSource = {},
): string[] {
  return drawProject(projectDir, component, source).problems
}

/**
 * One problem as a line: `definition: node (label) param: message [via path]`,
 * leaving out the parts it doesn't have.
 */
export function describeProblem(d: Diagnostic, library: Library): string {
  const where: string[] = []
  if (d.node !== undefined) {
    const spec = Object.hasOwn(library, d.component)
      ? library[d.component]
      : undefined
    const label = nodeLabel(spec?.nodes?.[d.node])
    where.push(label === undefined ? d.node : `${d.node} (${label})`)
  }
  if (d.param !== undefined) where.push(d.param)
  const via =
    d.path !== undefined && d.path.length > 0
      ? ` [via ${d.path.join(' > ')}]`
      : ''
  const place = where.length > 0 ? ` ${where.join(' ')}:` : ''
  return `${d.component}:${place} ${d.message}${via}`
}

export interface Io {
  out: (text: string) => void
  err: (text: string) => void
}

/** The arguments every command takes: a project, a component and its data. */
export interface Parsed {
  projectDir: string
  component: string
  source: DataSource
  /** Options the caller handles itself, by name. */
  extra: Record<string, string>
}

/**
 * Reads `<projectDir> <component> [--sample] [--data <file>]` and the
 * caller's own value options (`--out <file>`); throws a one-line message on
 * a usage error.
 */
export function parseArgs(
  argv: string[],
  usage: string,
  valueOptions: readonly string[] = [],
): Parsed {
  const positional: string[] = []
  const source: DataSource = {}
  const extra: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--sample') source.sample = true
    else if (arg === '--data' || valueOptions.includes(arg)) {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--'))
        throw new Error(`${arg} needs a file name. ${usage}`)
      if (arg === '--data') source.dataFile = value
      else extra[arg.slice(2)] = value
    } else if (arg.startsWith('-'))
      throw new Error(`Unknown option ${arg}. ${usage}`)
    else positional.push(arg)
  }
  if (positional.length !== 2) throw new Error(usage)
  if (source.sample && source.dataFile !== undefined)
    throw new Error(`Give --sample or --data, not both. ${usage}`)
  return { projectDir: positional[0], component: positional[1], source, extra }
}

const USAGE =
  'Usage: npm run check -- <projectDir> <component> [--sample | --data <file>]'

/** The command line: returns the exit code. */
export function main(argv: string[], io: Io): number {
  let problems: string[]
  try {
    const { projectDir, component, source } = parseArgs(argv, USAGE)
    problems = checkProject(projectDir, component, source)
  } catch (error) {
    io.err(`check: ${(error as Error).message}\n`)
    return 1
  }
  for (const line of problems) io.out(`${line}\n`)
  return problems.length > 0 ? 1 : 0
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
}
