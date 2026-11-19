import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toSvgString } from '../engine/index.ts'
import type { Diagnostic, SvgNode } from '../engine/index.ts'
import { describeLocation } from './diagnostics.ts'
import { fitPreview, hasAnimation } from './preview.ts'

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

/** What the preview shows inside a definition: the picture you came from, or the definition alone. */
export type PreviewMode = 'context' | 'isolated'

const MODES: readonly { value: PreviewMode; label: string }[] = [
  { value: 'context', label: 'In context' },
  { value: 'isolated', label: 'Isolated' },
]

export function PreviewPane({
  output,
  problems,
  mode,
  onMode,
  note,
}: {
  output: readonly SvgNode[]
  problems: readonly Diagnostic[]
  /** Set inside a definition, where the In context / Isolated choice applies. */
  mode?: PreviewMode
  onMode?: (mode: PreviewMode) => void
  /** A one-line remark under the controls, e.g. why nothing is highlighted. */
  note?: string
}) {
  // The markup comes from the engine: only element names from its node
  // registry, with every attribute value and text node escaped. That makes it
  // safe to insert directly.
  const markup = useMemo(() => toSvgString(fitPreview(output)), [output])
  const [backdrop, setBackdrop] = useState(savedBackdrop)
  const animated = useMemo(() => hasAnimation(output), [output])
  // Pausing is a passing authoring state, so it isn't remembered.
  const [paused, setPaused] = useState(false)
  const canvas = useRef<HTMLDivElement>(null)

  // Every data edit replaces the markup, and a new svg starts with its clock
  // running: pause it again before it is painted.
  useLayoutEffect(() => {
    const svg = canvas.current?.querySelector('svg')
    if (!svg) return
    if (paused && animated) {
      if (typeof svg.pauseAnimations === 'function') svg.pauseAnimations()
    } else if (typeof svg.unpauseAnimations === 'function')
      svg.unpauseAnimations()
  }, [markup, paused, animated])

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
      <div className="preview-controls">
        {mode && onMode && (
          <div
            className="backdrop-choice"
            role="radiogroup"
            aria-label="Preview of"
          >
            {MODES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={mode === choice.value}
                onClick={() => onMode(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
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
        {animated && (
          <div className="backdrop-choice">
            <button
              type="button"
              aria-pressed={paused}
              aria-label={paused ? 'Play animation' : 'Pause animation'}
              title="Freeze the preview's animations while you edit"
              onClick={() => setPaused(!paused)}
            >
              {paused ? 'Play' : 'Pause'}
            </button>
          </div>
        )}
      </div>
      {note && (
        <p className="preview-note" role="note">
          {note}
        </p>
      )}
      <div
        ref={canvas}
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
