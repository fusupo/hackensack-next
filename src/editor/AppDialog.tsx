import { useEffect, useId, useRef, useState } from 'react'

/** Ask for a name, checking it as it is typed. */
export interface NameRequest {
  kind: 'name'
  /** The question, e.g. "New name for sun". */
  question: string
  /** The name the field starts with (selected, so typing replaces it). */
  suggestion: string
  /** What is wrong with a name, or undefined when it can be used (`nameProblem`). */
  problemOf: (name: string) => string | undefined
  /** Called with the trimmed name, only when it has no problem. */
  onSubmit: (name: string) => void
}

/** Ask whether to go ahead with something that deletes. */
export interface ConfirmRequest {
  kind: 'confirm'
  title: string
  paragraphs: string[]
  /** The label of the button that goes ahead, e.g. "Delete". */
  confirmLabel: string
  onConfirm: () => void
}

export type DialogRequest = NameRequest | ConfirmRequest

/**
 * The editor's modal dialog, in place of the browser's own: a name field
 * that reports problems as you type, or a confirmation with a destructive
 * button. It is a native `<dialog>` shown modally, so the editor behind it
 * is inert and focus stays inside. Escape and Cancel call `onCancel`; render
 * it only while there is something to ask, and remove it to close it.
 */
export function AppDialog({
  request,
  onCancel,
}: {
  request: DialogRequest
  onCancel: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const element = dialog.current
    // StrictMode runs this twice; showing an open dialog again throws.
    if (element && !element.open) element.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="app-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: close through state, so React stays the source of truth.
        event.preventDefault()
        onCancel()
      }}
      onClose={() => {
        // The browser closed it anyway (a repeated Escape can't be refused).
        if (dialog.current) onCancel()
      }}
    >
      {request.kind === 'name' ? (
        <NameForm request={request} titleId={titleId} onCancel={onCancel} />
      ) : (
        <ConfirmForm request={request} titleId={titleId} onCancel={onCancel} />
      )}
    </dialog>
  )
}

function NameForm({
  request,
  titleId,
  onCancel,
}: {
  request: NameRequest
  titleId: string
  onCancel: () => void
}) {
  const [value, setValue] = useState(request.suggestion)
  const [touched, setTouched] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const hintId = useId()
  const problem = request.problemOf(value)
  // An empty field isn't a problem to point out until something was typed.
  const shown = touched || value !== '' ? problem : undefined

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (problem === undefined) request.onSubmit(value.trim())
      }}
    >
      <h2 id={titleId}>{request.question}</h2>
      <label htmlFor={inputId}>Name</label>
      <input
        id={inputId}
        ref={input}
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-describedby={hintId}
        aria-invalid={shown !== undefined}
        onChange={(event) => {
          setValue(event.target.value)
          setTouched(true)
        }}
      />
      <p id={hintId} className="app-dialog-hint">
        Letters, digits, - and _, starting with a letter or digit.
      </p>
      <p role="alert" className="app-dialog-problem">
        {shown}
      </p>
      <div className="app-dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!!problem}>
          OK
        </button>
      </div>
    </form>
  )
}

function ConfirmForm({
  request,
  titleId,
  onCancel,
}: {
  request: ConfirmRequest
  titleId: string
  onCancel: () => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)

  // Start on Cancel: Enter alone should never delete.
  useEffect(() => cancel.current?.focus(), [])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        request.onConfirm()
      }}
    >
      <h2 id={titleId}>{request.title}</h2>
      {request.paragraphs.map((text, i) => (
        <p key={i}>{text}</p>
      ))}
      <div className="app-dialog-actions">
        <button type="button" ref={cancel} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="danger-solid">
          {request.confirmLabel}
        </button>
      </div>
    </form>
  )
}
