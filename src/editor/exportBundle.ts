// Export for player (#16): the bundle file for the component the preview
// shows, made from the project in memory, so unsaved edits are in it. Pure:
// App.tsx turns the text into a download.

import { bundle } from '@hackensack/engine'
import type { Project } from './projects.ts'

export interface ExportedBundle {
  /** `<component>.bundle.json` */
  filename: string
  /** The bundle as 2-space JSON with a trailing newline. */
  text: string
}

/**
 * Bundles `component` (the top of the trail: the picture compiled and
 * previewed) with every definition it reaches. Its sample, when it has a
 * sample file, goes in as the bundle's default data, so the player draws
 * what the preview shows. Without one there is no data: the player then
 * uses the inputs' own defaults, as the engine always does.
 */
export function exportBundle(
  project: Pick<Project, 'library' | 'samples'>,
  component: string,
): ExportedBundle {
  const sample = Object.hasOwn(project.samples, component)
    ? project.samples[component]
    : undefined
  return {
    filename: `${component}.bundle.json`,
    text:
      JSON.stringify(bundle(component, project.library, sample), null, 2) +
      '\n',
  }
}
