// Reading a project folder from the command line (#16, #61): its components
// as a library, and the data to draw one with. Shared by `npm run bundle`,
// `npm run check` and `npm run render`. Every problem is thrown as an Error
// whose message is one line, for the script to print.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ComponentSpec } from '../packages/engine/src/index.ts'

/** Every `<projectDir>/components/*.json`, by file name, in name order. */
export function loadLibrary(projectDir: string): Record<string, ComponentSpec> {
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
  return library
}

/** Throws unless `component` is one of the library's. */
export function requireComponent(
  library: Readonly<Record<string, unknown>>,
  projectDir: string,
  component: string,
): void {
  if (!Object.hasOwn(library, component)) {
    throw new Error(`Unknown component "${component}" in ${projectDir}.`)
  }
}

/** Where a component's data comes from: its sample file, or another file. */
export interface DataSource {
  /** `<projectDir>/samples/<component>.data.json`. */
  sample?: boolean
  /** A JSON file of data, instead of the sample. */
  dataFile?: string
}

/**
 * The data a component is drawn with: its sample with `sample`, the file
 * `dataFile`, or undefined with neither (so input defaults apply).
 */
export function loadData(
  projectDir: string,
  component: string,
  source: DataSource,
): Record<string, unknown> | undefined {
  if (source.sample && source.dataFile !== undefined)
    throw new Error('Give --sample or --data, not both.')
  if (source.sample) {
    const file = join(projectDir, 'samples', `${component}.data.json`)
    if (!existsSync(file))
      throw new Error(`No sample for "${component}": ${file} is missing.`)
    return readData(file)
  }
  if (source.dataFile !== undefined) return readData(source.dataFile)
  return undefined
}

function readData(file: string): Record<string, unknown> {
  const data = readJson(file)
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    throw new Error(`${file} must hold a JSON object of data.`)
  return data as Record<string, unknown>
}

/** A JSON file's contents; throws a one-line message when it can't be read. */
export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Can't read ${file}: ${(error as Error).message}`)
  }
}
