// Makes a player bundle (#16) from a project folder:
//
//   npm run bundle -- <projectDir> <component> [--sample] [--out <file>]
//
// It reads <projectDir>/components/*.json, bundles <component> with every
// definition it reaches, adds <projectDir>/samples/<component>.data.json as
// default data with --sample, and prints the JSON (or writes it to --out).
// On any problem it prints one line to stderr, writes nothing and exits 1.
//
// Runs with Node 24's type stripping (`node scripts/bundle.ts`). It imports
// the engine by path, so it needs no workspace link in node_modules.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '../packages/engine/src/index.ts'
import type { Bundle, ComponentSpec } from '../packages/engine/src/index.ts'

export interface BundleOptions {
  /** Add the component's sample file as the bundle's default data. */
  sample?: boolean
}

/** Bundles `component` from the project folder `projectDir`. Throws on a problem. */
export function bundleProject(
  projectDir: string,
  component: string,
  options: BundleOptions = {},
): Bundle {
  const componentsDir = join(projectDir, 'components')
  if (!existsSync(componentsDir)) {
    throw new Error(`No project at ${projectDir}: it has no components folder.`)
  }
  const library: Record<string, ComponentSpec> = {}
  for (const file of readdirSync(componentsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    library[basename(file, '.json')] = readJson(
      join(componentsDir, file),
    ) as ComponentSpec
  }
  if (!Object.hasOwn(library, component)) {
    throw new Error(`Unknown component "${component}" in ${projectDir}.`)
  }
  let data: Record<string, unknown> | undefined
  if (options.sample) {
    const file = join(projectDir, 'samples', `${component}.data.json`)
    if (!existsSync(file))
      throw new Error(`No sample for "${component}": ${file} is missing.`)
    data = readJson(file) as Record<string, unknown>
  }
  return bundle(component, library, data)
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Can't read ${file}: ${(error as Error).message}`)
  }
}

const USAGE =
  'Usage: npm run bundle -- <projectDir> <component> [--sample] [--out <file>]'

/** The command line: returns the exit code. */
export function main(
  argv: string[],
  io: { out: (text: string) => void; err: (text: string) => void },
): number {
  const positional: string[] = []
  let sample = false
  let out: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--sample') sample = true
    else if (arg === '--out') {
      out = argv[++i]
      if (out === undefined)
        return fail(io, `--out needs a file name. ${USAGE}`)
    } else if (arg.startsWith('--out=')) out = arg.slice('--out='.length)
    else if (arg.startsWith('-'))
      return fail(io, `Unknown option ${arg}. ${USAGE}`)
    else positional.push(arg)
  }
  if (positional.length !== 2) return fail(io, USAGE)
  const [projectDir, component] = positional
  let text: string
  try {
    text =
      JSON.stringify(
        bundleProject(projectDir, component, { sample }),
        null,
        2,
      ) + '\n'
  } catch (error) {
    return fail(io, (error as Error).message)
  }
  if (out === undefined) io.out(text)
  else {
    try {
      writeFileSync(out, text)
    } catch (error) {
      return fail(io, `Can't write ${out}: ${(error as Error).message}`)
    }
  }
  return 0
}

function fail(io: { err: (text: string) => void }, message: string): number {
  io.err(`bundle: ${message}\n`)
  return 1
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
}
