import { Fragment } from 'react'
import type { Trail } from './trail.ts'

/**
 * Where you are among nested components, e.g. "sun-card › sun". Every crumb
 * but the last goes back out to that component; the last is the one being
 * edited.
 */
export function Breadcrumbs({
  trail,
  onNavigate,
}: {
  trail: Trail
  onNavigate: (index: number) => void
}) {
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
      {trail.length > 1 && (
        <span className="breadcrumbs-hint muted">
          Editing {trail[trail.length - 1]!.component} changes every instance
        </span>
      )}
    </nav>
  )
}
