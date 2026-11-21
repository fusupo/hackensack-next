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

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '../packages/engine/src/index.ts'
import type { Bundle } from '../packages/engine/src/index.ts'
import { loadData, loadLibrary, requireComponent } from './project.ts'

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
  const library = loadLibrary(projectDir)
  requireComponent(library, projectDir, component)
  const data = loadData(projectDir, component, { sample: options.sample })
  return bundle(component, library, data)
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
