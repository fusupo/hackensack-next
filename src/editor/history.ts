// The undo history: a stack of steps, one history per project (PLAN.md,
// Decisions: Undo and redo). Each step holds the before and after of exactly
// one target, a component's spec or a component's sample data, named by the
// component's definition id so a rename doesn't lose it. Pure: no React, no
// DOM, and no Project values (projects.ts imports this file).

/** What a step changed: a component's spec, or its sample data, by definition id. */
export interface Target {
  kind: 'component' | 'sample'
  id: string
}

export interface Step {
  target: Target
  /** The target before the step; undefined for a sample that didn't exist. */
  before: object | undefined
  after: object | undefined
  /** The field the edit came from, for merging one visit's edits (e.g. `param:n1:r`). */
  field?: string
  /** Whether the target's file was already pending (unsaved or queued for removal) before the step. */
  dirtyBefore: boolean
}

export interface History {
  past: readonly Step[]
  future: readonly Step[]
  /** The field being edited, while its visit lasts: the next edit to it merges into the top step. */
  open?: string
}

/** Steps kept per project; the oldest are dropped. */
export const HISTORY_LIMIT = 200

export const emptyHistory: History = { past: [], future: [] }

export const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && a.id === b.id

/**
 * Add a step. It merges into the top step when it comes from the same field
 * of the same target while that field's visit is still open; otherwise it is
 * pushed. Either way the redo steps are gone.
 */
export function record(history: History = emptyHistory, step: Step): History {
  const top = history.past[history.past.length - 1]
  if (
    top &&
    step.field !== undefined &&
    history.open === step.field &&
    top.field === step.field &&
    sameTarget(top.target, step.target)
  )
    return {
      past: [...history.past.slice(0, -1), { ...top, after: step.after }],
      future: [],
      open: step.field,
    }
  const past = [...history.past, step]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(-HISTORY_LIMIT) : past,
    future: [],
    ...(step.field !== undefined && { open: step.field }),
  }
}

/** End the current field visit: the next edit starts a new step. */
export function seal(history: History): History {
  if (history.open === undefined) return history
  return { past: history.past, future: history.future }
}

/** Take the top step off the past (to undo it); undefined if there is none. */
export function popUndo(
  history: History,
): { history: History; step: Step } | undefined {
  const step = history.past[history.past.length - 1]
  if (!step) return undefined
  return {
    step,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, step],
    },
  }
}

/** Take the next step off the future (to redo it); undefined if there is none. */
export function popRedo(
  history: History,
): { history: History; step: Step } | undefined {
  const step = history.future[history.future.length - 1]
  if (!step) return undefined
  return {
    step,
    history: {
      past: [...history.past, step],
      future: history.future.slice(0, -1),
    },
  }
}

/** The history without the steps whose target matches. */
export function dropTarget(
  history: History,
  matches: (target: Target) => boolean,
): History {
  const keep = (s: Step) => !matches(s.target)
  if (history.past.every(keep) && history.future.every(keep)) return history
  return {
    past: history.past.filter(keep),
    future: history.future.filter(keep),
  }
}

/** The history with the matching steps flagged as starting from a pending file. */
export function markDirty(
  history: History,
  matches: (target: Target) => boolean,
): History {
  const flag = (s: Step) =>
    !s.dirtyBefore && matches(s.target) ? { ...s, dirtyBefore: true } : s
  const past = history.past.map(flag)
  const future = history.future.map(flag)
  if (
    past.every((s, i) => s === history.past[i]) &&
    future.every((s, i) => s === history.future[i])
  )
    return history
  return { ...history, past, future }
}

/**
 * The status line's text for an undone or redone step, naming its component
 * by its current name; undefined when the step is on screen.
 */
export function describeStep(
  step: Step,
  nameOf: (id: string) => string | undefined,
  onScreen: boolean,
  direction: 'undo' | 'redo',
): string | undefined {
  if (onScreen) return undefined
  const verb = direction === 'undo' ? 'Undid' : 'Redid'
  const name = nameOf(step.target.id) ?? 'a component'
  return step.target.kind === 'component'
    ? `${verb} an edit in ${name}.`
    : `${verb} a change to the sample data of ${name}.`
}

/** The keys of a keyboard event that matter here. */
export interface KeyPress {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Undo or redo for a key press: Ctrl+Z or Cmd+Z undoes; with Shift it
 * redoes, and so does Ctrl+Y (not Cmd+Y, the browser's History on macOS).
 */
export function historyKeyAction(event: KeyPress): 'undo' | 'redo' | undefined {
  if (event.altKey) return undefined
  const key = event.key.toLowerCase()
  if (key === 'z' && (event.ctrlKey || event.metaKey))
    return event.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey)
    return 'redo'
  return undefined
}
