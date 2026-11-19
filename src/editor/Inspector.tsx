import { Fragment, useState } from 'react'
import { exposes, NODE_TYPES } from '../engine/index.ts'
import type {
  ComponentSpec,
  Diagnostic,
  InputDecl,
  InputType,
  NodeSpec,
  ParamDef,
  ParamKind,
  ParamValue,
} from '../engine/index.ts'
import { collapseProblem } from './collapse.ts'
import { describeLocation } from './diagnostics.ts'
import {
  addExpose,
  exposableParams,
  exposeNameError,
  parseParamInput,
  removeExpose,
  renameExpose,
  renameInput,
  repointExpose,
  setInput,
  setParam,
  setRef,
  setRoot,
} from './edit.ts'
import { NAME } from './projects.ts'
import type { SampleData } from './projects.ts'
import { scopeAt } from './scope.ts'
import {
  definitionName,
  instancesText,
  usageCount,
  usesByComponent,
} from './usage.ts'
import type { Usage } from './usage.ts'

/**
 * Apply an edit. `field` names the field it came from (e.g. `param:n1:r`), so
 * consecutive edits to it merge into one undo step; one-shot edits leave it out.
 */
type Edit = (
  update: (spec: ComponentSpec) => ComponentSpec,
  field?: string,
) => void

const GROUP_TITLES: Record<ParamDef['group'], string> = {
  document: 'Picture',
  geometry: 'Geometry',
  text: 'Text',
  repeat: 'Repeat',
  presentation: 'Style',
  animation: 'Animation',
  timing: 'Timing',
}
const GROUP_ORDER: ParamDef['group'][] = [
  'document',
  'repeat',
  'geometry',
  'text',
  'presentation',
  'animation',
  'timing',
]

const KIND_HINTS: Record<ParamKind, string> = {
  number: 'expression',
  length: 'expression; may end in % or px',
  color: 'text, or =expression',
  string: 'text, or =expression',
  transform: 'translate(x, y) rotate(deg) scale(s)…',
  expr: 'expression',
  name: 'variable name',
  path: 'SVG path data; numbers in {braces} are expressions, e.g. M 0 0 L {w} {h} Z; or =expression',
  points:
    'a list of [x, y] pairs like pts, or text like 0,0 {w},0 {w / 2},{h}; or =expression',
  time: 'seconds: an expression, e.g. 60 / wind',
  template:
    'text, with numbers in {braces} from expressions, e.g. 0 {cx} {cy}; or =expression',
  attribute: 'an attribute name, e.g. r, opacity; or =expression',
}

const show = (value: ParamValue | undefined) =>
  value === undefined ? '' : String(value)

/**
 * A text field for one param. Keeps its own text while you type (so "1.50"
 * doesn't snap to "1.5"), commits every change, and picks up outside changes.
 */
function ParamField({
  label,
  kind,
  value,
  placeholder,
  hint,
  problems,
  onCommit,
}: {
  label: string
  kind: ParamKind
  value: ParamValue | undefined
  placeholder?: string
  hint?: string
  problems: readonly string[]
  onCommit: (value: ParamValue | undefined) => void
}) {
  const [text, setText] = useState(show(value))
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    if (parseParamInput(kind, text) !== value) setText(show(value))
  }
  const id = `param-${label}`
  return (
    <div className={`field${problems.length > 0 ? ' has-problems' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={problems.length > 0}
        title={hint ?? KIND_HINTS[kind]}
        onChange={(e) => {
          const next = parseParamInput(kind, e.target.value)
          setText(e.target.value)
          setSynced(next)
          onCommit(next)
        }}
      />
      {problems.map((p, i) => (
        <p key={i} className="field-problem">
          {p}
        </p>
      ))}
    </div>
  )
}

function ScopeList({
  spec,
  component,
  node,
  sample,
}: {
  spec: ComponentSpec
  component: string
  node: string
  sample: SampleData
}) {
  const frames = scopeAt(spec, component, node, sample) ?? []
  return (
    <section className="inspector-section">
      <h3>In scope here</h3>
      {frames.every((f) => f.vars.length === 0) ? (
        <p className="placeholder">
          No variables. Declare inputs on the component, or add an each or a
          grid above this node.
        </p>
      ) : (
        frames
          .filter((f) => f.vars.length > 0)
          .map((frame) => (
            <div key={frame.label} className="scope-frame">
              <h4>{frame.label}</h4>
              <ul>
                {frame.vars.map((v) => (
                  <li
                    key={v.name}
                    className={v.shadowed ? 'shadowed' : undefined}
                    title={
                      v.shadowed
                        ? 'Hidden by a nearer variable with the same name'
                        : undefined
                    }
                  >
                    <code>{v.name}</code>{' '}
                    <span className="muted">{v.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </section>
  )
}

/**
 * One exposed variable: its name (applied on Enter or leaving the field), the
 * param it holds, and a Remove button. Every change is one undo step.
 */
function ExposeRow({
  id,
  node,
  name,
  param,
  onEdit,
}: {
  id: string
  node: NodeSpec
  name: string
  param: string
  onEdit: Edit
}) {
  const [draft, setDraft] = useState(name)
  const error = exposeNameError(node, name, draft)
  const commit = () => {
    if (draft !== name && !error)
      onEdit((s) => renameExpose(s, id, name, draft))
    else setDraft(name)
  }
  const params = node.params ?? {}
  const def = NODE_TYPES[node.type]
  const choices = Object.keys(def?.params ?? {}).filter((p) =>
    Object.hasOwn(params, p),
  )
  return (
    <li className="expose-row">
      <input
        aria-label={`Variable name for ${param}`}
        value={draft}
        spellCheck={false}
        aria-invalid={error !== undefined}
        title={error ?? 'The name children use to read this param'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <select
        aria-label={`Param exposed as ${name}`}
        value={param}
        onChange={(e) =>
          onEdit((s) => repointExpose(s, id, name, e.target.value))
        }
      >
        {!choices.includes(param) && (
          <option value={param}>(not set) {param}</option>
        )}
        {choices.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={`Stop exposing ${name}`}
        title="Stop exposing"
        onClick={() => onEdit((s) => removeExpose(s, id, name))}
      >
        ×
      </button>
      {error && <p className="field-problem">{error}</p>}
    </li>
  )
}

/** The node's exposed variables, which its children can read. */
function ExposeSection({
  id,
  node,
  onEdit,
}: {
  id: string
  node: NodeSpec
  onEdit: Edit
}) {
  const entries = Object.entries(node.expose ?? {})
  const offered = exposableParams(node)
  return (
    <section className="inspector-section">
      <h3>Exposed variables</h3>
      <p className="muted small">
        Children can read the params exposed here, under these names.
      </p>
      {entries.length > 0 && (
        <ul className="expose-list">
          {entries.map(([name, param]) => (
            <ExposeRow
              key={name}
              id={id}
              node={node}
              name={name}
              param={param}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
      <select
        aria-label="Expose a param"
        className="expose-add"
        value=""
        disabled={offered.length === 0}
        title={
          offered.length === 0
            ? 'Set a param above to expose it'
            : 'Make a param readable by the children'
        }
        onChange={(e) => {
          const param = e.target.value
          if (param) onEdit((s) => addExpose(s, id, param))
        }}
      >
        <option value="">
          {offered.length === 0
            ? entries.length === 0
              ? 'Set a param to expose it'
              : 'Every set param is exposed'
            : 'Expose a param…'}
        </option>
        {offered.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </section>
  )
}

function bindingKind(decl: InputDecl): ParamKind {
  if (decl.type === 'string') return 'string'
  if (decl.type === 'number') return 'number'
  return 'expr'
}

function bindingPlaceholder(name: string, decl: InputDecl): string {
  if (decl.inherit) return `inherits ${name} if left empty`
  if ('default' in decl) return `default ${JSON.stringify(decl.default)}`
  return 'required'
}

function NodeInspector(props: {
  spec: ComponentSpec
  component: string
  library: Readonly<Record<string, ComponentSpec>>
  /** Components an instance here can't use (the trail of entered components). */
  exclude: readonly string[]
  /** Where each component is used (usage.ts). */
  usage: Usage
  node: string
  problems: readonly Diagnostic[]
  sample: SampleData
  onEdit: Edit
  onDelete: (id: string) => void
  /** Give an instance its own copy of its definition; absent when read-only. */
  onMakeUnique?: (id: string) => void
  /** Collapse a node and its subtree into a new component; absent when read-only. */
  onCollapse?: (id: string) => void
}) {
  const { spec, component, library, node: id, problems, onEdit } = props
  const node = spec.nodes[id]!
  const def = NODE_TYPES[node.type]
  const params = node.params ?? {}
  const own = problems.filter(
    (d) =>
      d.component === component && d.node === id && (d.path?.length ?? 0) === 0,
  )
  const problemsFor = (param: string) =>
    own.filter((d) => d.param === param).map((d) => d.message)
  const nodeProblems = own.filter(
    (d) =>
      !d.param ||
      (def && !(d.param in def.params) && node.type !== 'component'),
  )
  const set =
    (name: string, field?: string) => (value: ParamValue | undefined) =>
      onEdit((s) => setParam(s, id, name, value), field)
  /** The param's text field: typing in it is one undo step per visit. */
  const typed = (name: string) => set(name, `param:${id}:${name}`)
  const isRoot = id === spec.root

  let body
  if (node.type === 'component') {
    // The ref is the definition's id; everything shown uses its name.
    const targetName = definitionName(library, node.ref)
    const target = targetName ? library[targetName] : undefined
    const inputs = target?.inputs ?? {}
    const unknown = Object.keys(params).filter((name) => !(name in inputs))
    const inside = problems.filter((d) => d.path?.[0] === id)
    body = (
      <>
        <section className="inspector-section">
          <div className="field">
            <label htmlFor="ref">Definition</label>
            <select
              id="ref"
              value={node.ref ?? ''}
              onChange={(e) => onEdit((s) => setRef(s, id, e.target.value))}
            >
              {!node.ref && <option value="">(choose)</option>}
              {node.ref && !targetName && (
                <option value={node.ref}>missing component</option>
              )}
              {Object.entries(library)
                .filter(([name]) => !props.exclude.includes(name))
                .map(([name, s]) => (
                  <option key={name} value={s.id}>
                    {name}
                  </option>
                ))}
            </select>
          </div>
          {targetName && props.onMakeUnique && (
            <MakeUnique
              id={id}
              name={targetName}
              uses={usageCount(props.usage, targetName)}
              onMakeUnique={props.onMakeUnique}
            />
          )}
        </section>
        {targetName && <UsedIn name={targetName} usage={props.usage} />}
        <section className="inspector-section">
          <h3>Inputs</h3>
          {Object.keys(inputs).length === 0 && (
            <p className="placeholder">
              {target
                ? `${targetName} declares no inputs.`
                : node.ref
                  ? 'Its definition is missing: it was deleted, or its id changed. Choose another one.'
                  : 'Choose a definition.'}
            </p>
          )}
          {Object.entries(inputs).map(([name, decl]) => (
            <ParamField
              key={name}
              label={name}
              kind={bindingKind(decl)}
              value={params[name]}
              placeholder={bindingPlaceholder(name, decl)}
              hint={`${decl.type ?? 'any'}${decl.inherit ? ', inherited' : ''}`}
              problems={problemsFor(name)}
              onCommit={typed(name)}
            />
          ))}
          {unknown.map((name) => (
            <p key={name} className="field-problem">
              Binding for unknown input <code>{name}</code>{' '}
              <button type="button" onClick={() => set(name)(undefined)}>
                Remove
              </button>
            </p>
          ))}
        </section>
        {inside.length > 0 && (
          <section className="inspector-section">
            <h3>Problems inside {targetName ?? 'the definition'}</h3>
            <ul className="problem-list">
              {inside.map((d, i) => (
                <li key={i}>
                  <span className="problem-where">{describeLocation(d)}</span>{' '}
                  {d.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    )
  } else if (def) {
    const groups = GROUP_ORDER.map((group) => ({
      group,
      names: Object.keys(def.params).filter(
        (name) => def.params[name]!.group === group,
      ),
    })).filter((g) => g.names.length > 0)
    const unknown = Object.keys(params).filter((name) => !(name in def.params))
    body = (
      <>
        {groups.map(({ group, names }) => (
          <section key={group} className="inspector-section">
            <h3>{GROUP_TITLES[group]}</h3>
            {names.map((name) => {
              const paramDef = def.params[name]!
              return (
                <ParamField
                  key={name}
                  label={name}
                  kind={paramDef.kind}
                  value={params[name]}
                  placeholder={
                    paramDef.default !== undefined
                      ? String(paramDef.default)
                      : undefined
                  }
                  problems={problemsFor(name)}
                  onCommit={typed(name)}
                />
              )
            })}
          </section>
        ))}
        {unknown.length > 0 && (
          <section className="inspector-section">
            <h3>Unknown params</h3>
            {unknown.map((name) => (
              <p key={name} className="field-problem">
                <code>{name}</code> = {show(params[name])}{' '}
                <button type="button" onClick={() => set(name)(undefined)}>
                  Remove
                </button>
              </p>
            ))}
          </section>
        )}
        {exposes(def) && <ExposeSection id={id} node={node} onEdit={onEdit} />}
      </>
    )
  } else {
    body = <p className="field-problem">Unknown node type "{node.type}".</p>
  }

  return (
    <div className="inspector">
      <header className="inspector-header">
        <div>
          <strong>
            {node.type === 'component'
              ? (definitionName(library, node.ref) ??
                (node.ref ? 'missing component' : 'component'))
              : node.type}
          </strong>{' '}
          <span className="muted">{id}</span>
          {isRoot && <span className="badge">root</span>}
        </div>
        <div className="inspector-actions">
          {!isRoot && (
            <button
              type="button"
              onClick={() => onEdit((s) => setRoot(s, id))}
              title="Render this node as the picture"
            >
              Make root
            </button>
          )}
          {!isRoot && (
            <button
              type="button"
              className="danger"
              onClick={() => props.onDelete(id)}
            >
              Delete
            </button>
          )}
        </div>
      </header>
      {props.onCollapse && (
        <CollapseToComponent
          id={id}
          problem={collapseProblem(spec, id)}
          onCollapse={props.onCollapse}
        />
      )}
      {nodeProblems.map((d, i) => (
        <p key={i} className="field-problem">
          {d.param ? `${d.param}: ` : ''}
          {d.message}
        </p>
      ))}
      {body}
      <ScopeList
        spec={spec}
        component={component}
        node={id}
        sample={props.sample}
      />
    </div>
  )
}

const INPUT_TYPES: InputType[] = [
  'number',
  'string',
  'boolean',
  'list',
  'object',
  'any',
]

/** One input declaration. Name changes apply on Enter or leaving the field. */
function InputRow({
  spec,
  name,
  decl,
  onEdit,
}: {
  spec: ComponentSpec
  name: string
  decl: InputDecl
  onEdit: Edit
}) {
  const [draftName, setDraftName] = useState(name)
  const asText = decl.type === 'string'
  const shownDefault = !('default' in decl)
    ? ''
    : asText && typeof decl.default === 'string'
      ? decl.default
      : JSON.stringify(decl.default)
  const [defaultText, setDefaultText] = useState(shownDefault)
  const [defaultError, setDefaultError] = useState<string>()
  // Pick up outside changes to the default (an undo or redo), as ParamField
  // does, but keep the text while it is the user's own (e.g. "1.50").
  const [syncedDefault, setSyncedDefault] = useState<unknown>(decl.default)
  if (decl.default !== syncedDefault) {
    setSyncedDefault(decl.default)
    setDefaultText(shownDefault)
    setDefaultError(undefined)
  }

  const nameError =
    draftName === name
      ? undefined
      : !NAME.test(draftName) || !/^[A-Za-z_]\w*$/.test(draftName)
        ? 'Use letters, digits and _'
        : draftName in (spec.inputs ?? {})
          ? 'Name taken'
          : undefined
  const commitName = () => {
    if (draftName !== name && !nameError)
      onEdit((s) => renameInput(s, name, draftName))
    else setDraftName(name)
  }
  const update = (
    changes: Partial<InputDecl>,
    removeDefault = false,
    field?: string,
  ) =>
    onEdit((s) => {
      const next: InputDecl = { ...decl, ...changes }
      if (removeDefault) delete next.default
      if (!next.inherit) delete next.inherit
      return setInput(s, name, next)
    }, field)
  /** Typing in the default field: one undo step per visit, text kept as typed. */
  const typeDefault = (value: unknown, remove = false) => {
    setSyncedDefault(remove ? undefined : value)
    update(remove ? {} : { default: value }, remove, `input:${name}:default`)
  }

  return (
    <li className="input-row">
      <input
        aria-label="Input name"
        className="input-name"
        value={draftName}
        spellCheck={false}
        aria-invalid={nameError !== undefined}
        title={nameError}
        onChange={(e) => setDraftName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === 'Enter' && commitName()}
      />
      <select
        aria-label={`Type of ${name}`}
        value={decl.type ?? 'any'}
        onChange={(e) => update({ type: e.target.value as InputType })}
      >
        {INPUT_TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <input
        aria-label={`Default for ${name}`}
        className="input-default"
        placeholder={asText ? 'default text' : 'default (JSON)'}
        value={defaultText}
        spellCheck={false}
        aria-invalid={defaultError !== undefined}
        title={
          defaultError ??
          (asText
            ? 'Leave empty for no default'
            : 'JSON, e.g. 25, [1, 2], {"a": 1}. Empty: no default')
        }
        onChange={(e) => {
          const text = e.target.value
          setDefaultText(text)
          if (text.trim() === '') {
            setDefaultError(undefined)
            typeDefault(undefined, true)
          } else if (asText) {
            setDefaultError(undefined)
            typeDefault(text)
          } else {
            try {
              const value: unknown = JSON.parse(text)
              setDefaultError(undefined)
              typeDefault(value)
            } catch {
              setDefaultError('Not valid JSON yet')
            }
          }
        }}
      />
      <label
        className="inherit"
        title="If an instance doesn't set it, look it up by name where the instance is"
      >
        <input
          type="checkbox"
          checked={decl.inherit === true}
          onChange={(e) => update({ inherit: e.target.checked })}
        />
        inherit
      </label>
      <button
        type="button"
        aria-label={`Remove input ${name}`}
        title="Remove input"
        onClick={() => onEdit((s) => setInput(s, name, undefined))}
      >
        ×
      </button>
    </li>
  )
}

/**
 * The Make unique button (#13): copy the instance's definition and point the
 * instance at the copy. Disabled when the instance is the definition's only
 * use, since the copy would leave the original unused.
 */
function MakeUnique(props: {
  id: string
  name: string
  uses: number
  onMakeUnique: (id: string) => void
}) {
  const { id, name, uses } = props
  const sole = uses < 2
  return (
    <div className="make-unique">
      <button
        type="button"
        disabled={sole}
        title={
          sole
            ? `Only this instance uses ${name}`
            : `Copy ${name} and point ${id} at the copy; the other instances keep ${name}`
        }
        onClick={() => props.onMakeUnique(id)}
      >
        Make unique…
      </button>
      {sole && <p className="placeholder">Only this instance uses {name}.</p>}
    </div>
  )
}

/**
 * The Collapse to component button (#14): turn the node and everything below
 * it into a new component. Disabled, with the reason shown, for the root and
 * for an instance.
 */
function CollapseToComponent(props: {
  id: string
  problem: string | undefined
  onCollapse: (id: string) => void
}) {
  const { id, problem } = props
  return (
    <div className="collapse-node">
      <button
        type="button"
        disabled={problem !== undefined}
        title={
          problem ??
          'Turn this node and everything below it into a new component'
        }
        onClick={() => props.onCollapse(id)}
      >
        Collapse to component…
      </button>
      {problem && <p className="placeholder">{problem}</p>}
    </div>
  )
}

/** Where a definition is used: each component with instances of it, and their node ids. */
function UsedIn({ name, usage }: { name: string; usage: Usage }) {
  const uses = usage.get(name) ?? []
  return (
    <section className="inspector-section">
      <h3>
        Used in{uses.length > 0 ? ` · ${instancesText(uses.length)}` : ''}
      </h3>
      {uses.length === 0 ? (
        <p className="placeholder">
          {name} is unused: no component in this project has an instance of it.
        </p>
      ) : (
        <ul className="used-in">
          {usesByComponent(uses).map(({ component, nodes }) => (
            <li key={component}>
              <strong>{component}</strong>{' '}
              {nodes.map((node, i) => (
                <Fragment key={node}>
                  {i > 0 && ', '}
                  <code>{node}</code>
                </Fragment>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ComponentInspector({
  spec,
  component,
  usage,
  problems,
  onEdit,
}: {
  spec: ComponentSpec
  component: string
  usage: Usage
  problems: readonly Diagnostic[]
  onEdit: Edit
}) {
  const inputs = spec.inputs ?? {}
  const own = problems.filter(
    (d) => d.component === component && !d.node && (d.path?.length ?? 0) === 0,
  )
  const addInput = () => {
    let n = 1
    while (`input${n}` in inputs) n++
    onEdit((s) => setInput(s, `input${n}`, { type: 'number' }))
  }
  return (
    <div className="inspector">
      <header className="inspector-header">
        <div>
          <strong>{component}</strong>{' '}
          <span className="muted">component · root {spec.root}</span>
        </div>
      </header>
      <p className="placeholder">
        Select a node to edit it. Add nodes from the palette; wire a node's
        output (right) into a slot on its parent (left).
      </p>
      <UsedIn name={component} usage={usage} />
      <section className="inspector-section">
        <h3>Inputs</h3>
        <p className="muted small">
          What this component needs to be drawn: the data at the top level, or
          an instance's bindings.
        </p>
        <ul className="input-list">
          {Object.entries(inputs).map(([name, decl]) => (
            <InputRow
              key={name}
              spec={spec}
              name={name}
              decl={decl}
              onEdit={onEdit}
            />
          ))}
        </ul>
        <button type="button" onClick={addInput}>
          Add input
        </button>
      </section>
      {own.length > 0 && (
        <section className="inspector-section">
          <h3>Component problems</h3>
          <ul className="problem-list">
            {own.map((d, i) => (
              <li key={i}>
                {d.param ? <code>{d.param}</code> : null} {d.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export function Inspector(props: {
  spec: ComponentSpec
  component: string
  library: Readonly<Record<string, ComponentSpec>>
  /** Components an instance here can't use (the trail of entered components). */
  exclude: readonly string[]
  /** Where each component is used (usage.ts). */
  usage: Usage
  selected: string | undefined
  problems: readonly Diagnostic[]
  sample: SampleData
  onEdit: Edit
  onDelete: (id: string) => void
  /** Give an instance its own copy of its definition; absent when read-only. */
  onMakeUnique?: (id: string) => void
  /** Collapse a node and its subtree into a new component; absent when read-only. */
  onCollapse?: (id: string) => void
}) {
  const { selected, spec } = props
  if (selected && spec.nodes[selected]) {
    return <NodeInspector key={selected} {...props} node={selected} />
  }
  return (
    <ComponentInspector
      spec={spec}
      component={props.component}
      usage={props.usage}
      problems={props.problems}
      onEdit={props.onEdit}
    />
  )
}
