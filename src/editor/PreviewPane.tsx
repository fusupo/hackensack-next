import { useMemo, useState } from 'react'
import { toSvgString } from '../engine/index.ts'
import type { Diagnostic, SvgNode } from '../engine/index.ts'
import { describeLocation } from './diagnostics.ts'
import { fitPreview } from './preview.ts'

const BACKDROPS = ['checker', 'light', 'dark'] as const
type Backdrop = (typeof BACKDROPS)[number]
const BACKDROP_KEY = 'hackensack-next:preview-backdrop'

/** The viewer's last backdrop choice. Storage can be unavailable; fall back quietly. */
function savedBackdrop(): Backdrop {
  try {
    const value = localStorage.getItem(BACKDROP_KEY)
    return BACKDROPS.includes(value as Backdrop)
      ? (value as Backdrop)
      : 'checker'
  } catch {
    return 'checker'
  }
}

export function PreviewPane({
  output,
  problems,
}: {
  output: readonly SvgNode[]
  problems: readonly Diagnostic[]
}) {
  // The markup comes from the engine: only element names from its node
  // registry, with every attribute value and text node escaped. That makes it
  // safe to insert directly.
  const markup = useMemo(() => toSvgString(fitPreview(output)), [output])
  const [backdrop, setBackdrop] = useState(savedBackdrop)

  const chooseBackdrop = (choice: Backdrop) => {
    setBackdrop(choice)
    try {
      localStorage.setItem(BACKDROP_KEY, choice)
    } catch {
      // Not remembered; fine.
    }
  }

  return (
    <div className="preview">
      <div
        className="backdrop-choice"
        role="radiogroup"
        aria-label="Preview background"
      >
        {BACKDROPS.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={backdrop === choice}
            onClick={() => chooseBackdrop(choice)}
          >
            {choice}
          </button>
        ))}
      </div>
      <div
        className={`preview-canvas backdrop-${backdrop}`}
        data-testid="preview"
        dangerouslySetInnerHTML={{ __html: markup }}
      />
      {problems.length > 0 && (
        <div className="problems" role="status">
          <h3>
            {problems.length} {problems.length === 1 ? 'problem' : 'problems'}
          </h3>
          <ul>
            {problems.map((d, i) => (
              <li key={i}>
                <span className="problem-where">{describeLocation(d)}</span>
                <span className="problem-message">{d.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
