// Undo and redo on a project: edits to its components and samples recorded in
// its history (history.ts), and undone or redone by definition id, with the
// files' saved state kept honest. Component and project operations (new,
// rename, duplicate, delete) aren't recorded; projects.ts keeps the history
// right through them. Make unique and Collapse to component are both: the new
// definition isn't recorded, and the change to the component the user is
// editing is one ordinary step.

import type { ComponentSpec } from '../engine/index.ts'
import { collapseProblem, planCollapse } from './collapse.ts'
import { freezeLayout, setRef } from './edit.ts'
import { emptyHistory, popRedo, popUndo, record, seal } from './history.ts'
import type { History, Step } from './history.ts'
import { newId, idsIn } from './ids.ts'
import { autoLayout } from './layout.ts'
import {
  addComponent,
  componentNameProblem,
  duplicateComponent,
  markUnsaved,
  queueRemoval,
  setSample,
  updateComponent,
} from './projects.ts'
import type { Outcome, Project, ProjectFile, SampleData } from './projects.ts'
import type { RandomBytes } from './ids.ts'
import { definitionName } from './usage.ts'

const isPending = (project: Project, file: ProjectFile) =>
  project.unsaved.includes(file) || project.removed.includes(file)

/** The project with a step recorded; the first edit's freeze is part of `update`. */
const withStep = (project: Project, next: Project, step: Step): Project => ({
  ...next,
  history: record(project.history, step),
})

/**
 * Apply an edit to a component and record it. `field` names the field the
 * edit came from, so one visit's edits merge into one step. Returns the same
 * project when nothing changed (and records nothing).
 */
export function editComponent(
  project: Project,
  name: string,
  update: (spec: ComponentSpec) => ComponentSpec,
  field?: string,
): Project {
  const before = project.library[name]
  if (!before) return project
  const next = updateComponent(project, name, update)
  if (next === project) return project
  return withStep(project, next, {
    target: { kind: 'component', id: before.id },
    before,
    after: next.library[name],
    ...(field !== undefined && { field }),
    dirtyBefore: isPending(project, `components/${name}`),
  })
}

/** Set a component's sample data and record it, as `editComponent` does. */
export function editSample(
  project: Project,
  component: string,
  data: SampleData,
  field?: string,
): Project {
  const spec = project.library[component]
  if (!spec) return project
  const before = Object.hasOwn(project.samples, component)
    ? project.samples[component]
    : undefined
  if (before !== undefined && JSON.stringify(before) === JSON.stringify(data))
    return project
  const next = setSample(project, component, data)
  return withStep(project, next, {
    target: { kind: 'sample', id: spec.id },
    before,
    after: data,
    ...(field !== undefined && { field }),
    dirtyBefore: isPending(project, `samples/${component}`),
  })
}

/**
 * Make unique (#13): give one instance its own copy of its definition. The
 * copy is made as Duplicate makes it (a new id, the sample copied, refs inside
 * it unchanged) and, like Duplicate, isn't recorded. Pointing the instance at
 * the copy is one ordinary recorded step on `component`, with no field, so it
 * never merges with a field visit: undo points the instance back at the
 * original and leaves the copy where it is, unused.
 */
export function makeUnique(
  project: Project,
  component: string,
  nodeId: string,
  to: string,
  random?: RandomBytes,
): Outcome {
  if (project.readOnly) return { error: `${project.name} is read-only.` }
  const parent = Object.hasOwn(project.library, component)
    ? project.library[component]
    : undefined
  if (!parent) return { error: `There is no component named "${component}".` }
  const node = Object.hasOwn(parent.nodes, nodeId)
    ? parent.nodes[nodeId]
    : undefined
  if (node?.type !== 'component')
    return { error: `${nodeId} isn't an instance of a component.` }
  if (!node.ref) return { error: `${nodeId} has no definition to copy.` }
  const original = definitionName(project.library, node.ref)
  if (!original)
    return {
      error: `${nodeId}'s definition is missing, so there is nothing to copy.`,
    }
  const problem = componentNameProblem(project, to)
  if (problem) return { error: problem }
  const copied = duplicateComponent(project, original, to, random)
  if ('error' in copied) return copied
  const copyId = copied.project.library[to]!.id
  return {
    project: editComponent(copied.project, component, (s) =>
      setRef(s, nodeId, copyId),
    ),
  }
}

/**
 * Collapse to component (#14): turn `nodeId` and everything below it into a
 * new definition `to`, and put one instance of it in the node's place (see
 * collapse.ts). The new definition and its sample are added as New adds a
 * component and, like it, aren't recorded. The change to `component` is one
 * ordinary recorded step with no field, so it never merges with a field
 * visit: undo puts the nodes back and leaves `to` where it is, unused. The
 * step also freezes `component`'s automatic layout, which removing nodes
 * would otherwise rearrange, and the new definition keeps the positions the
 * nodes had on screen.
 */
export function collapseToComponent(
  project: Project,
  component: string,
  nodeId: string,
  to: string,
  random?: RandomBytes,
): Outcome {
  if (project.readOnly) return { error: `${project.name} is read-only.` }
  const parent = Object.hasOwn(project.library, component)
    ? project.library[component]
    : undefined
  if (!parent) return { error: `There is no component named "${component}".` }
  const refused = collapseProblem(parent, nodeId)
  if (refused) return { error: `Can't collapse ${nodeId}: ${refused}` }
  const problem = componentNameProblem(project, to)
  if (problem) return { error: problem }
  const frozen = freezeLayout(parent, autoLayout(parent))
  const sample = Object.hasOwn(project.samples, component)
    ? project.samples[component]
    : undefined
  const plan = planCollapse(
    { ...project.library, [component]: frozen },
    component,
    nodeId,
    newId(idsIn(project.library), random),
    sample,
  )
  if (!plan) return { error: `Can't collapse ${nodeId}.` }
  let next = addComponent(project, to, plan.definition)
  if (plan.sample) next = setSample(next, to, plan.sample)
  return { project: editComponent(next, component, () => plan.parent) }
}

/** What an undo or redo did: the step it applied, or why it dropped one. */
export type HistoryMove =
  { project: Project; step: Step } | { project: Project; dropped: string }

/**
 * Put a step's `value` back into the project, if the target still holds
 * `expected` (it always should; a step that doesn't is dropped, not applied).
 */
function apply(
  project: Project,
  step: Step,
  expected: object | undefined,
  value: object | undefined,
  pending: 'undo' | 'redo',
): Project | string {
  const name = definitionName(project.library, step.target.id)
  if (!name) return 'Its component no longer exists.'
  const what = step.target.kind === 'component' ? 'components' : 'samples'
  const file: ProjectFile = `${what}/${name}`
  const current =
    step.target.kind === 'component'
      ? project.library[name]
      : Object.hasOwn(project.samples, name)
        ? project.samples[name]
        : undefined
  if (current !== expected) return `${name} has changed since.`
  // Undo puts back the file's state from before the step; redo always changes it.
  const lists =
    pending === 'redo' || step.dirtyBefore
      ? value === undefined
        ? queueRemoval(project, file)
        : markUnsaved(project, file)
      : {
          unsaved: project.unsaved.filter((f) => f !== file),
          removed: project.removed,
        }
  if (step.target.kind === 'component')
    return {
      ...project,
      library: { ...project.library, [name]: value as ComponentSpec },
      ...lists,
    }
  const samples = Object.fromEntries(
    Object.entries(project.samples).filter(([k]) => k !== name),
  ) as Record<string, SampleData>
  if (value !== undefined) samples[name] = value as SampleData
  return { ...project, samples, ...lists }
}

function move(project: Project, direction: 'undo' | 'redo') {
  const history = project.history ?? emptyHistory
  const popped = direction === 'undo' ? popUndo(history) : popRedo(history)
  if (!popped) return undefined
  const { step } = popped
  const applied =
    direction === 'undo'
      ? apply(project, step, step.after, step.before, 'undo')
      : apply(project, step, step.before, step.after, 'redo')
  if (typeof applied === 'string') {
    // Drop the step altogether rather than move it across.
    const dropped: History =
      direction === 'undo'
        ? { past: popped.history.past, future: history.future }
        : { past: history.past, future: popped.history.future }
    return {
      project: { ...project, history: dropped },
      dropped: `Couldn't ${direction} the last edit: ${applied}`,
    }
  }
  return { project: { ...applied, history: popped.history }, step }
}

/** Undo the project's last edit; undefined when there is nothing to undo. */
export function undoProject(project: Project): HistoryMove | undefined {
  return move(project, 'undo')
}

/** Redo the project's last undone edit; undefined when there is nothing to redo. */
export function redoProject(project: Project): HistoryMove | undefined {
  return move(project, 'redo')
}

/** End the current field visit (the same project when there is none). */
export function sealProject(project: Project): Project {
  if (!project.history || project.history.open === undefined) return project
  return { ...project, history: seal(project.history) }
}

export const canUndo = (project: Project | undefined) =>
  (project?.history?.past.length ?? 0) > 0

export const canRedo = (project: Project | undefined) =>
  (project?.history?.future.length ?? 0) > 0
