import type { InputDecl } from '@hackensack/engine'

function describeInput(decl: InputDecl): string {
  const parts: string[] = [decl.type ?? 'any']
  if (decl.inherit) parts.push('inherited')
  if ('default' in decl) parts.push(`default ${JSON.stringify(decl.default)}`)
  return parts.join(', ')
}

/**
 * The sample data the preview renders with: a JSON object whose keys are the
 * component's inputs. Edits apply as you type; while the text isn't valid
 * JSON the preview keeps showing the last valid data.
 */
export function DataPane({
  inputs,
  text,
  error,
  onChange,
  onFillMissing,
}: {
  inputs: Readonly<Record<string, InputDecl>>
  text: string
  error: string | undefined
  onChange: (text: string) => void
  /** Add declared inputs the data doesn't have yet. Absent when nothing is missing. */
  onFillMissing: (() => void) | undefined
}) {
  const names = Object.keys(inputs)
  return (
    <div className="data">
      <div className="data-inputs">
        {names.length === 0 ? (
          <span className="placeholder">
            This component declares no inputs.
          </span>
        ) : (
          <ul>
            {names.map((name) => (
              <li key={name}>
                <code>{name}</code>{' '}
                <span className="muted">{describeInput(inputs[name]!)}</span>
              </li>
            ))}
          </ul>
        )}
        {onFillMissing && (
          <button type="button" onClick={onFillMissing}>
            Add missing inputs
          </button>
        )}
      </div>
      <textarea
        className={error ? 'invalid' : undefined}
        aria-label="Sample data (JSON)"
        aria-invalid={error !== undefined}
        spellCheck={false}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p className="data-error">
          {error} The preview shows the last valid data.
        </p>
      )}
    </div>
  )
}
