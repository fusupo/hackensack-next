import { Fragment } from 'react'
import type { Trail } from './trail.ts'
import { instancesText } from './usage.ts'

/**
 * Where you are among nested components, e.g. "sun-card › sun". Every crumb
 * but the last goes back out to that component; the last is the one being
 * edited. When other components use it, a hint says how many instances an
 * edit changes.
 */
export function Breadcrumbs({
  trail,
  uses,
  onNavigate,
}: {
  trail: Trail
  /** How many instance nodes use the component being edited (usage.ts). */
  uses: number
  onNavigate: (index: number) => void
}) {
  const editing = trail[trail.length - 1]!.component
  return (
    <nav className="breadcrumbs" aria-label="Component trail">
      <ol>
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1
          return (
            <Fragment key={`${i}/${crumb.component}`}>
              {i > 0 && (
                <li className="breadcrumb-separator" aria-hidden="true">
                  ›
                </li>
              )}
              <li>
                {last ? (
                  <span className="breadcrumb-current" aria-current="page">
                    {crumb.component}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="breadcrumb"
                    title={`Back to ${crumb.component}`}
                    onClick={() => onNavigate(i)}
                  >
                    {crumb.component}
                  </button>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
      {uses > 0 && (
        <span className="breadcrumbs-hint muted">
          Editing {editing} changes {instancesText(uses)}
        </span>
      )}
    </nav>
  )
}
