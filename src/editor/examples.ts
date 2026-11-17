// The example projects in examples/, bundled at build time.
// M2 is read-only; loading and saving real project folders arrives with M3.

import { groupProjectFiles } from './projects.ts'

const componentFiles = import.meta.glob('/examples/*/components/*.json', {
  eager: true,
  import: 'default',
})
const sampleFiles = import.meta.glob('/examples/*/samples/*.data.json', {
  eager: true,
  import: 'default',
})

export const EXAMPLE_PROJECTS = groupProjectFiles(componentFiles, sampleFiles)
