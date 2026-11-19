// The undo history (#10): the pure step stack in history.ts, and what the
// editor builds on it. Every test is a top-level `it`, so its JUnit name is
// `src/editor/history.test.ts::<title>` (the validation contract selects them).

import { expect, it } from 'vitest'
import {
  describeStep,
  emptyHistory,
  HISTORY_LIMIT,
  historyKeyAction,
  popRedo,
  popUndo,
  record,
  seal,
} from './history.ts'
import type { History, KeyPress, Step } from './history.ts'

const step = (
  id: string,
  before: number,
  after: number,
  field?: string,
  kind: 'component' | 'sample' = 'component',
): Step => ({
  target: { kind, id },
  before: { v: before },
  after: { v: after },
  ...(field !== undefined && { field }),
  dirtyBefore: false,
})

const values = (h: History) =>
  h.past.map((s) => [
    (s.before as { v: number }).v,
    (s.after as { v: number }).v,
  ])

it('consecutive edits to the same field merge into one step until the history is sealed', () => {
  let h = record(emptyHistory, step('a', 0, 1, 'param:n1:r'))
  h = record(h, step('a', 1, 2, 'param:n1:r'))
  h = record(h, step('a', 2, 3, 'param:n1:r'))
  expect(values(h)).toEqual([[0, 3]])
  expect(h.open).toBe('param:n1:r')
  // Leaving the field seals the visit; coming back starts a new step.
  h = seal(h)
  expect(h.open).toBeUndefined()
  h = record(h, step('a', 3, 4, 'param:n1:r'))
  expect(values(h)).toEqual([
    [0, 3],
    [3, 4],
  ])
  // An undo seals too.
  h = popUndo(h)!.history
  h = popRedo(h)!.history
  h = record(h, step('a', 4, 5, 'param:n1:r'))
  expect(values(h)).toHaveLength(3)
  // Edits without a field never merge.
  let one = record(emptyHistory, step('a', 0, 1))
  one = record(one, step('a', 1, 2))
  expect(values(one)).toHaveLength(2)
})

it('an edit to a different field or component starts a new step', () => {
  let h = record(emptyHistory, step('a', 0, 1, 'param:n1:r'))
  h = record(h, step('a', 1, 2, 'param:n1:cx'))
  expect(values(h)).toHaveLength(2)
  // Same field key, different component: a new step.
  h = record(h, step('b', 0, 1, 'param:n1:cx'))
  expect(values(h)).toHaveLength(3)
  // Same component and key, but the sample rather than the spec.
  h = record(h, step('b', 0, 1, 'param:n1:cx', 'sample'))
  expect(values(h)).toHaveLength(4)
  // A one-shot edit in between ends the visit.
  h = record(h, step('b', 1, 2, 'sample', 'sample'))
  h = record(h, step('b', 2, 3))
  h = record(h, step('b', 3, 4, 'sample', 'sample'))
  expect(values(h)).toHaveLength(7)
})

it('a new edit clears the redo steps', () => {
  let h = record(emptyHistory, step('a', 0, 1))
  h = record(h, step('a', 1, 2))
  h = popUndo(h)!.history
  expect(h.future).toHaveLength(1)
  expect(popRedo(h)!.step.after).toEqual({ v: 2 })
  h = record(h, step('a', 1, 7))
  expect(h.future).toEqual([])
  expect(popRedo(h)).toBeUndefined()
  expect(values(h)).toEqual([
    [0, 1],
    [1, 7],
  ])
})

it("describes a step by its component's current name, only when it isn't on screen", () => {
  const names = new Map([['id-sun', 'star']])
  const nameOf = (id: string) => names.get(id)
  const edit = step('id-sun', 0, 1)
  expect(describeStep(edit, nameOf, false, 'undo')).toBe(
    'Undid an edit in star.',
  )
  expect(describeStep(edit, nameOf, false, 'redo')).toBe(
    'Redid an edit in star.',
  )
  expect(describeStep(edit, nameOf, true, 'undo')).toBeUndefined()
  expect(
    describeStep(
      step('id-sun', 0, 1, undefined, 'sample'),
      nameOf,
      false,
      'undo',
    ),
  ).toBe('Undid a change to the sample data of star.')
})

it('maps Ctrl+Z, Ctrl+Shift+Z, Cmd+Z and Ctrl+Y to undo and redo, and ignores other keys, Alt and Cmd+Y', () => {
  const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  })
  expect(historyKeyAction(press('z', { ctrlKey: true }))).toBe('undo')
  expect(historyKeyAction(press('z', { metaKey: true }))).toBe('undo')
  // Shift+Z reports an upper-case key.
  expect(historyKeyAction(press('Z', { ctrlKey: true, shiftKey: true }))).toBe(
    'redo',
  )
  expect(historyKeyAction(press('Z', { metaKey: true, shiftKey: true }))).toBe(
    'redo',
  )
  expect(historyKeyAction(press('y', { ctrlKey: true }))).toBe('redo')
  expect(historyKeyAction(press('y', { metaKey: true }))).toBeUndefined()
  expect(historyKeyAction(press('z'))).toBeUndefined()
  expect(historyKeyAction(press('z', { ctrlKey: true, altKey: true }))).toBe(
    undefined,
  )
  expect(historyKeyAction(press('s', { ctrlKey: true }))).toBeUndefined()
  expect(historyKeyAction(press('x', { ctrlKey: true }))).toBeUndefined()
})

it('keeps only the latest 200 steps', () => {
  expect(HISTORY_LIMIT).toBe(200)
  let h = emptyHistory
  for (let i = 0; i < 250; i++) h = record(h, step('a', i, i + 1))
  expect(h.past).toHaveLength(200)
  expect(values(h)[0]).toEqual([50, 51])
  expect(values(h)[199]).toEqual([249, 250])
})
