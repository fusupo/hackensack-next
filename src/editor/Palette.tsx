import type { DragEvent } from 'react'
import { PALETTE_DRAG_TYPE } from './GraphView.tsx'
import type { PaletteItem } from './GraphView.tsx'

const GROUPS: { title: string; types: string[] }[] = [
  { title: 'Structure', types: ['svg', 'g', 'each'] },
  { title: 'Shapes', types: ['rect', 'circle', 'ellipse', 'line', 'text'] },
]

const DESCRIPTIONS: Record<string, string> = {
  svg: 'A picture: the usual root',
  g: 'A group; transform or style its children together',
  each: 'Repeat its children once per item of a list',
  rect: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  line: 'Line',
  text: 'Text',
}

/**
 * Node types and the project's components. Click to add a node, or drag one
 * onto the graph to place it.
 */
export function Palette({
  components,
  onAdd,
}: {
  /** Components that can be used here (the one being edited is left out). */
  components: readonly string[]
  onAdd: (item: PaletteItem) => void
}) {
  const item = (entry: PaletteItem, label: string, title: string) => (
    <li key={`${entry.type}/${entry.ref ?? ''}`}>
      <button
        type="button"
        className={`palette-item palette-${entry.ref ? 'component' : entry.type}`}
        draggable
        title={`${title}. Click to add, or drag onto the graph.`}
        onClick={() => onAdd(entry)}
        onDragStart={(event: DragEvent) => {
          event.dataTransfer.setData(PALETTE_DRAG_TYPE, JSON.stringify(entry))
          event.dataTransfer.effectAllowed = 'copy'
        }}
      >
        {label}
      </button>
    </li>
  )

  return (
    <div className="palette">
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h3>{group.title}</h3>
          <ul>
            {group.types.map((type) =>
              item({ type }, type, DESCRIPTIONS[type] ?? type),
            )}
          </ul>
        </section>
      ))}
      <section>
        <h3>Components</h3>
        {components.length === 0 ? (
          <p className="placeholder">
            No other components in this project yet.
          </p>
        ) : (
          <ul>
            {components.map((name) =>
              item(
                { type: 'component', ref: name },
                name,
                `An instance of ${name}`,
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  )
}
