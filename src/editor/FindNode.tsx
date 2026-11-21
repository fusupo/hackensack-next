import { useState } from 'react'
import type { ComponentSpec } from '@hackensack/engine'
import { describeFound, findNodes } from './find.ts'

/**
 * The graph view's find box (#59): type part of a label, a type, a
 * definition name or an id, then pick a match (click it, or Enter for the
 * highlighted one) to bring that node into view and select it. It searches
 * the component being edited only. Escape clears it.
 */
export function FindNode({
  spec,
  names,
  onPick,
}: {
  spec: ComponentSpec
  names: ReadonlyMap<string, string>
  onPick: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const matches = findNodes(spec, query, names)
  const shown = Math.min(active, Math.max(matches.length - 1, 0))
  const pick = (id: string) => {
    setQuery('')
    setActive(0)
    onPick(id)
  }

  return (
    <div className="graph-find">
      <input
        type="search"
        aria-label="Find node"
        placeholder="Find node by label, type or id"
        value={query}
        spellCheck={false}
        aria-controls="find-node-results"
        aria-expanded={query.trim() !== ''}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery('')
            setActive(0)
          } else if (e.key === 'ArrowDown' && matches.length > 0) {
            e.preventDefault()
            setActive((shown + 1) % matches.length)
          } else if (e.key === 'ArrowUp' && matches.length > 0) {
            e.preventDefault()
            setActive((shown - 1 + matches.length) % matches.length)
          } else if (e.key === 'Enter' && matches[shown]) {
            e.preventDefault()
            pick(matches[shown].id)
          }
        }}
      />
      {query.trim() !== '' && (
        <ul
          id="find-node-results"
          role="listbox"
          aria-label="Matching nodes"
          className="graph-find-results"
        >
          {matches.length === 0 && (
            <li className="graph-find-none">No node matches.</li>
          )}
          {matches.map((found, i) => (
            <li
              key={found.id}
              role="option"
              aria-selected={i === shown}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(found.id)}
            >
              {describeFound(found)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
