// The undo history (#10): the pure step stack in history.ts, and what the
// editor builds on it. Every test is a top-level `it`, so its JUnit name is
// `src/editor/history.test.ts::<title>` (the validation contract selects them).

import { expect, it } from 'vitest'
import { SPEC_FORMAT } from '../engine/index.ts'
import type { ComponentSpec } from '../engine/index.ts'
import { prettyData, syncDataText } from './datatext.ts'
import type { DataText } from './datatext.ts'
import { freezeLayout, moveNodes, removeElements, setParam } from './edit.ts'
import { autoLayout } from './layout.ts'
import {
  canRedo,
  canUndo,
  editComponent,
  editSample,
  redoProject,
  undoProject,
} from './projectHistory.ts'
import {
  addComponent,
  deleteComponent,
  duplicateComponent,
  duplicateProject,
  markRemoved,
  markSaved,
  markWritten,
  newProject,
  renameComponent,
  renameProject,
} from './projects.ts'
import type { Outcome, Project } from './projects.ts'
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

it('moveNodes returns the same spec when no node moved', () => {
  const spec: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'id-a',
    root: 'n0',
    nodes: {
      n0: { type: 'svg', children: ['n1'] },
      n1: { type: 'circle' },
    },
    editor: { n0: { x: 10, y: 20 }, n1: { x: -200, y: 0 } },
  }
  expect(moveNodes(spec, { n0: { x: 10, y: 20 } })).toBe(spec)
  expect(moveNodes(spec, { n0: { x: 10, y: 20 }, n1: { x: -200, y: 0 } })).toBe(
    spec,
  )
  expect(moveNodes(spec, { nope: { x: 1, y: 1 } })).toBe(spec)
  const moved = moveNodes(spec, { n0: { x: 10, y: 20 }, n1: { x: -150, y: 5 } })
  expect(moved).not.toBe(spec)
  expect(moved.editor).toEqual({ n0: { x: 10, y: 20 }, n1: { x: -150, y: 5 } })
})

it('removing nodes and their wires is a single edit that undoes in one step', () => {
  const spec: ComponentSpec = {
    format: SPEC_FORMAT,
    id: 'id-a',
    root: 'n0',
    nodes: {
      n0: { type: 'svg', children: ['n1', 'n2', 'n3'] },
      n1: { type: 'circle' },
      n2: { type: 'g', children: ['n4'] },
      n3: { type: 'circle' },
      n4: { type: 'rect' },
    },
  }
  // What the Delete key hands over for a wired n2 plus a selected wire n0 ← n3:
  // the node, the wire into its parent, the wire from its child, and the extra wire.
  const removed = removeElements(
    spec,
    ['n2'],
    [
      { parent: 'n0', child: 'n2' },
      { parent: 'n2', child: 'n4' },
      { parent: 'n0', child: 'n3' },
    ],
  )
  expect(removed.nodes.n0!.children).toEqual(['n1'])
  expect(removed.nodes.n2).toBeUndefined()
  expect(removed.nodes.n4).toEqual({ type: 'rect' })
  expect(removed.nodes.n3).toEqual({ type: 'circle' })
  // One edit: one step whose undo restores the wired node exactly.
  const h = record(emptyHistory, {
    target: { kind: 'component', id: 'id-a' },
    before: spec,
    after: removed,
    dirtyBefore: false,
  })
  expect(h.past).toHaveLength(1)
  expect(popUndo(h)!.step.before).toBe(spec)
  // A lone wire is one disconnect; nothing to remove gives the same spec.
  expect(
    removeElements(spec, [], [{ parent: 'n0', child: 'n3' }]).nodes.n0!
      .children,
  ).toEqual(['n1', 'n2'])
  expect(removeElements(spec, [], [])).toBe(spec)
})

// ---- projects (projectHistory.ts) ----

const card = (): ComponentSpec => ({
  format: SPEC_FORMAT,
  id: 'id-card',
  root: 'n0',
  nodes: { n0: { type: 'svg', children: ['n1'] }, n1: { type: 'circle' } },
})
const sun = (): ComponentSpec => ({
  format: SPEC_FORMAT,
  id: 'id-sun',
  inputs: { r: { type: 'number', default: 1 } },
  root: 'n0',
  nodes: { n0: { type: 'circle', params: { r: '=r' } } },
})
const twoComponents = (): Project => ({
  root: 'projects',
  name: 'p',
  readOnly: false,
  library: { card: card(), sun: sun() },
  samples: { sun: { r: 3 } },
  unsaved: [],
  removed: [],
  onDisk: true,
  problems: [],
})
const setR = (value: number) => (s: ComponentSpec) =>
  setParam(s, 'n1', 'r', value)

it('an edit records a step and undo and redo restore the component spec', () => {
  const start = twoComponents()
  const edited = editComponent(start, 'card', setR(5))
  expect(edited.library.card!.nodes.n1!.params).toEqual({ r: 5 })
  expect(edited.history!.past).toHaveLength(1)
  expect(canUndo(edited)).toBe(true)
  expect(canRedo(edited)).toBe(false)
  const undone = undoProject(edited)!
  expect('step' in undone).toBe(true)
  expect(undone.project.library.card).toBe(start.library.card)
  expect(canUndo(undone.project)).toBe(false)
  expect(canRedo(undone.project)).toBe(true)
  const redone = redoProject(undone.project)!
  expect(redone.project.library.card).toBe(edited.library.card)
  expect(redoProject(redone.project)).toBeUndefined()
  expect(undoProject(start)).toBeUndefined()
})

it('undoing the first edit brings back the spec before the layout was frozen', () => {
  const start = twoComponents()
  const original = start.library.card!
  expect(original.editor).toBeUndefined()
  // As App's onEdit does it: freeze the automatic layout, then edit.
  const edited = editComponent(start, 'card', (s) =>
    setR(5)(freezeLayout(s, autoLayout(s))),
  )
  const frozen = edited.library.card!
  expect(frozen.editor).toEqual(
    Object.fromEntries(autoLayout(original).entries()),
  )
  const undone = undoProject(edited)!.project
  expect(undone.library.card).toBe(original)
  // Positions are the same either way, so nothing moves on screen.
  expect(autoLayout(undone.library.card!)).toEqual(
    new Map(Object.entries(frozen.editor!)),
  )
  expect(redoProject(undone)!.project.library.card).toBe(frozen)
})

it('undo and redo of sample data restore it, including a sample that did not exist', () => {
  const start = twoComponents()
  const edited = editSample(start, 'sun', { r: 9 }, 'sample')
  expect(edited.samples.sun).toEqual({ r: 9 })
  expect(undoProject(edited)!.project.samples.sun).toBe(start.samples.sun)
  // card had no sample: undoing its first sample edit takes it away again.
  const added = editSample(start, 'card', { x: 1 }, 'sample')
  expect(added.samples.card).toEqual({ x: 1 })
  const removed = undoProject(added)!.project
  expect(Object.hasOwn(removed.samples, 'card')).toBe(false)
  expect(removed.unsaved).toEqual([])
  expect(removed.removed).toEqual([])
  expect(redoProject(removed)!.project.samples.card).toEqual({ x: 1 })
})

it('one history covers every component and sample of the project, and each step names its target by definition id', () => {
  let p = twoComponents()
  p = editComponent(p, 'card', setR(5))
  p = editComponent(p, 'sun', (s) => setParam(s, 'n0', 'cx', 4))
  p = editSample(p, 'sun', { r: 7 })
  expect(p.history!.past.map((s) => s.target)).toEqual([
    { kind: 'component', id: 'id-card' },
    { kind: 'component', id: 'id-sun' },
    { kind: 'sample', id: 'id-sun' },
  ])
  // Undo goes back through them in order, whatever is on screen.
  const one = undoProject(p)!
  expect('step' in one && one.step.target).toEqual({
    kind: 'sample',
    id: 'id-sun',
  })
  expect(one.project.samples.sun).toEqual({ r: 3 })
  const two = undoProject(one.project)!
  expect(two.project.library.sun!.nodes.n0!.params).toEqual({ r: '=r' })
  const three = undoProject(two.project)!
  expect(three.project.library.card!.nodes.n1!.params).toBeUndefined()
  expect(three.project.library).toEqual(twoComponents().library)
})

it('undoing to no sample queues the file for removal when it was saved or queued before', () => {
  // card's sample was saved, then taken away (as a delete would): an edit
  // brings it back, and undoing that must delete the file again on save.
  const queued: Project = { ...twoComponents(), removed: ['samples/card'] }
  const added = editSample(queued, 'card', { x: 1 })
  expect(added.unsaved).toEqual(['samples/card'])
  expect(added.removed).toEqual([])
  const undone = undoProject(added)!.project
  expect(Object.hasOwn(undone.samples, 'card')).toBe(false)
  expect(undone.unsaved).toEqual([])
  expect(undone.removed).toEqual(['samples/card'])
  // A sample written but not saved, then undone to nothing: the same.
  const pending: Project = { ...twoComponents(), unsaved: ['samples/card'] }
  const again = undoProject(editSample(pending, 'card', { x: 2 }))!.project
  expect(again.removed).toEqual(['samples/card'])
  expect(again.unsaved).toEqual([])
})

it('a step whose target no longer holds its result is dropped, not applied', () => {
  const edited = editComponent(twoComponents(), 'card', setR(5))
  // Something changed card outside the history.
  const meddled: Project = {
    ...edited,
    library: { ...edited.library, card: setR(8)(edited.library.card!) },
  }
  const move = undoProject(meddled)!
  expect('dropped' in move && move.dropped).toBe(
    "Couldn't undo the last edit: card has changed since.",
  )
  expect(move.project.library.card).toBe(meddled.library.card)
  expect(move.project.history!.past).toEqual([])
  expect(move.project.history!.future).toEqual([])
})

it('an edit that changes nothing records no step', () => {
  const start = twoComponents()
  expect(editComponent(start, 'card', (s) => s)).toBe(start)
  expect(editComponent(start, 'nope', setR(1))).toBe(start)
  expect(editSample(start, 'sun', { r: 3 })).toBe(start)
  expect(
    editComponent(start, 'card', (s) => moveNodes(s, { n0: { x: 0, y: 0 } })),
  ).not.toBe(start)
  const placed = editComponent(start, 'card', (s) =>
    moveNodes(s, { n0: { x: 0, y: 0 } }),
  )
  expect(
    editComponent(placed, 'card', (s) => moveNodes(s, { n0: { x: 0, y: 0 } })),
  ).toBe(placed)
  expect(placed.history!.past).toHaveLength(1)
})

const ok = (outcome: Outcome): Project => {
  if ('error' in outcome) throw new Error(outcome.error)
  return outcome.project
}

it('undo marks the file unsaved unless the step began from a clean file, and saving flags the earlier steps', () => {
  const start = twoComponents()
  // Edit and undo before any save: back to Saved.
  const edited = editComponent(start, 'card', setR(5))
  expect(edited.unsaved).toEqual(['components/card'])
  expect(undoProject(edited)!.project.unsaved).toEqual([])
  // A second edit began from an unsaved file: undoing it keeps it unsaved.
  const twice = editComponent(edited, 'card', setR(6))
  expect(undoProject(twice)!.project.unsaved).toEqual(['components/card'])
  // Save, then undo: disk holds the edit, so the file is unsaved again.
  const saved = markSaved(edited, ['components/card'])
  expect(saved.unsaved).toEqual([])
  expect(saved.history!.past[0]!.dirtyBefore).toBe(true)
  const undone = undoProject(saved)!.project
  expect(undone.library.card).toBe(start.library.card)
  expect(undone.unsaved).toEqual(['components/card'])
  // Redo always marks the file unsaved.
  expect(redoProject(undoProject(edited)!.project)!.project.unsaved).toEqual([
    'components/card',
  ])
  // A save that ran while the file was edited again: the file stays
  // unsaved, but disk holds the first edit, so undoing both mustn't say Saved.
  const during = editComponent(edited, 'card', setR(6))
  const settled = markSaved(markWritten(during, ['components/card']), [])
  expect(settled.unsaved).toEqual(['components/card'])
  const back = undoProject(undoProject(settled)!.project)!.project
  expect(back.library.card).toBe(start.library.card)
  expect(back.unsaved).toEqual(['components/card'])
  // Saving one file leaves the other files' steps alone.
  const both = editSample(edited, 'sun', { r: 4 })
  const savedSample = markSaved(both, ['samples/sun'])
  expect(savedSample.history!.past.map((s) => s.dirtyBefore)).toEqual([
    false,
    true,
  ])
})

it('undo still finds a renamed component by its id', () => {
  let p = editComponent(twoComponents(), 'sun', (s) =>
    setParam(s, 'n0', 'cx', 4),
  )
  p = editSample(p, 'sun', { r: 5 })
  p = ok(renameComponent(p, 'sun', 'star'))
  const sample = undoProject(p)!
  expect(
    'step' in sample &&
      describeStep(
        sample.step,
        (id) => (id === 'id-sun' ? 'star' : undefined),
        false,
        'undo',
      ),
  ).toBe('Undid a change to the sample data of star.')
  expect(sample.project.samples.star).toEqual({ r: 3 })
  const spec = undoProject(sample.project)!.project
  expect(spec.library.star!.nodes.n0!.params).toEqual({ r: '=r' })
  expect(spec.library.sun).toBeUndefined()
  // Its files are new and unsaved; the old ones stay queued for deletion.
  expect(spec.unsaved).toEqual(['components/star', 'samples/star'])
  expect(spec.removed).toEqual(['components/sun', 'samples/sun'])
})

it('deleting a component drops its steps and leaves the others', () => {
  let p = editComponent(twoComponents(), 'card', setR(5))
  p = editComponent(p, 'sun', (s) => setParam(s, 'n0', 'cx', 4))
  p = editSample(p, 'sun', { r: 5 })
  p = ok(deleteComponent(p, 'sun'))
  expect(p.history!.past.map((s) => s.target)).toEqual([
    { kind: 'component', id: 'id-card' },
  ])
  const undone = undoProject(p)!.project
  expect(undone.library.card!.nodes.n1!.params).toBeUndefined()
  expect(undone.removed).toEqual(['components/sun', 'samples/sun'])
})

it('component and project operations are not recorded as steps', () => {
  const p = editComponent(twoComponents(), 'card', setR(5))
  const steps = (q: Project) => q.history!.past.length
  expect(steps(addComponent(p, 'moon'))).toBe(1)
  expect(steps(ok(renameComponent(p, 'card', 'deck')))).toBe(1)
  expect(steps(ok(duplicateComponent(p, 'card', 'deck')))).toBe(1)
  expect(steps(ok(deleteComponent(p, 'sun')))).toBe(1)
  expect(steps(ok(renameProject(p, 'q', [p])))).toBe(1)
  expect(steps(markRemoved(p, ['components/x']))).toBe(1)
  // And none of them clears the redo steps either.
  const undone = undoProject(p)!.project
  expect(canRedo(addComponent(undone, 'moon'))).toBe(true)
  expect(canRedo(ok(renameComponent(undone, 'card', 'deck')))).toBe(true)
})

it('a new or duplicated project starts with no history and a renamed project keeps it', () => {
  const p = editComponent(twoComponents(), 'card', setR(5))
  expect(canUndo(p)).toBe(true)
  const copy = duplicateProject(p, 'projects', 'copy')
  expect(copy.history).toBeUndefined()
  expect(canUndo(copy)).toBe(false)
  expect(newProject('projects', 'fresh').history).toBeUndefined()
  const renamed = ok(renameProject(p, 'q', [p]))
  expect(renamed.history).toBe(p.history)
  expect(undoProject(renamed)!.project.library.card).toBe(
    p.history!.past[0]!.before,
  )
})

it('the Sample data text follows the data after an undo but keeps an invalid draft otherwise', () => {
  const empty: DataText = { key: '', text: '', synced: '' }
  const shown = syncDataText(empty, 'p/sun', { r: 3 })
  expect(shown).toEqual({
    key: 'p/sun',
    text: '{\n  "r": 3\n}',
    synced: '{\n  "r": 3\n}',
  })
  // The same data again, even a new object: nothing changes.
  expect(syncDataText(shown, 'p/sun', { r: 3 })).toBe(shown)
  // An invalid draft survives while the data stays the same.
  const draft: DataText = { ...shown, text: '{ "r": ', error: 'Not valid JSON' }
  expect(syncDataText(draft, 'p/sun', { r: 3 })).toBe(draft)
  // The user's own valid text, in their formatting, stays too.
  const typed: DataText = {
    key: 'p/sun',
    text: '{"r":4}',
    synced: prettyData({ r: 4 }),
  }
  expect(syncDataText(typed, 'p/sun', { r: 4 })).toBe(typed)
  // An undo changes the data under it: the text follows, the draft is gone.
  expect(syncDataText(draft, 'p/sun', { r: 1 })).toEqual({
    key: 'p/sun',
    text: '{\n  "r": 1\n}',
    synced: '{\n  "r": 1\n}',
  })
  // Other data shown: its own text.
  expect(syncDataText(typed, 'p/card', { r: 4 }).key).toBe('p/card')
})
