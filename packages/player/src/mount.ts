// mount() (#16): draws a bundle's picture into a page element and keeps it
// up to date with update(data). Problems never throw: they show in a small
// note over the picture's bottom-left corner and in `handle.errors`.

import { createRenderer, describeProblem } from './core.ts'
import type { Problem } from './core.ts'

/** Where a picture goes: an element, or a shadow root. */
export type MountTarget = Element | DocumentFragment

export interface PlayerHandle {
  /**
   * Draws again with `data` laid over the bundle's default data. Each call
   * replaces the data given before: it isn't merged with the last call's.
   */
  update(data?: Record<string, unknown>): void
  /** Empties the target. Later updates do nothing. */
  destroy(): void
  /** The problems of the last draw: the bundle's, compiling's and rendering's. */
  readonly errors: Problem[]
  readonly element: MountTarget
}

/** mount()'s handle, plus problems from outside the bundle (the element's). */
export interface InternalHandle extends PlayerHandle {
  updateWith(data: Record<string, unknown> | undefined, extra: Problem[]): void
}

/**
 * Draws `bundle` (a parsed bundle object) into `target`, replacing what was
 * there, with `data` laid over the bundle's default data. The bundle is
 * compiled once; `update(data)` only renders.
 */
export function mount(
  target: MountTarget,
  bundle: unknown,
  data?: Record<string, unknown>,
): PlayerHandle {
  return mountWith(target, bundle, data, [])
}

export function mountWith(
  target: MountTarget,
  bundle: unknown,
  data: Record<string, unknown> | undefined,
  extra: Problem[],
): InternalHandle {
  // A bundle that couldn't be loaded at all (the element's src failed) is
  // reported by the caller; don't add "a bundle must be an object" to it.
  const renderer =
    bundle === undefined && extra.length > 0
      ? { render: () => ({ markup: '', errors: [] }) }
      : createRenderer(bundle)
  const doc = target.ownerDocument ?? document

  const frame = doc.createElement('div')
  frame.setAttribute('data-hackensack-frame', '')
  frame.style.position = 'relative'
  const picture = doc.createElement('div')
  picture.setAttribute('data-hackensack-picture', '')
  picture.style.lineHeight = '0'
  const note = doc.createElement('div')
  note.setAttribute('data-hackensack-problems', '')
  note.setAttribute('role', 'status')
  Object.assign(note.style, {
    position: 'absolute',
    left: '4px',
    bottom: '4px',
    maxWidth: 'calc(100% - 8px)',
    maxHeight: 'calc(100% - 8px)',
    overflow: 'auto',
    boxSizing: 'border-box',
    padding: '2px 6px',
    font: '11px/1.35 system-ui, sans-serif',
    color: '#7a1414',
    background: 'rgba(255, 255, 255, 0.92)',
    border: '1px solid #e0a3a3',
    borderRadius: '4px',
  })
  frame.append(picture, note)
  target.replaceChildren(frame)

  let errors: Problem[] = []
  let destroyed = false

  function draw(
    given: Record<string, unknown> | undefined,
    outside: Problem[],
  ) {
    if (destroyed) return
    const result = renderer.render(given)
    errors = [...outside, ...result.errors]
    // Engine markup only: registry elements with escaped values (the
    // editor's preview inserts it the same way).
    picture.innerHTML = result.markup
    showProblems(note, errors)
  }

  draw(data, extra)
  return {
    update: (next) => draw(next, []),
    updateWith: draw,
    destroy() {
      destroyed = true
      target.replaceChildren()
    },
    get errors() {
      return [...errors]
    },
    element: target,
  }
}

/** Fills the note, as text only: messages can hold anything. */
function showProblems(note: HTMLElement, problems: Problem[]) {
  if (problems.length === 0) {
    note.hidden = true
    note.replaceChildren()
    return
  }
  const doc = note.ownerDocument
  const details = doc.createElement('details')
  const summary = doc.createElement('summary')
  summary.textContent =
    problems.length === 1 ? '1 problem' : `${problems.length} problems`
  summary.style.cursor = 'pointer'
  const list = doc.createElement('ul')
  Object.assign(list.style, { margin: '2px 0 0', paddingLeft: '16px' })
  for (const problem of problems) {
    const item = doc.createElement('li')
    item.textContent = describeProblem(problem)
    list.append(item)
  }
  details.append(summary, list)
  note.replaceChildren(details)
  note.hidden = false
}
