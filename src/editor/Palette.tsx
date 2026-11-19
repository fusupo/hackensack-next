import type { DragEvent, ReactNode } from 'react'
import { PALETTE_DRAG_TYPE } from './GraphView.tsx'
import type { PaletteItem } from './GraphView.tsx'
import { usageCount } from './usage.ts'
import type { Usage } from './usage.ts'

const GROUPS: { title: string; types: string[] }[] = [
  { title: 'Structure', types: ['svg', 'g', 'each', 'grid'] },
  {
    title: 'Shapes',
    types: [
      'rect',
      'circle',
      'ellipse',
      'line',
      'path',
      'polygon',
      'polyline',
      'text',
    ],
  },
  { title: 'Animation', types: ['animate', 'animateTransform'] },
]

const DESCRIPTIONS: Record<string, string> = {
  svg: 'A picture: the usual root',
  g: 'A group; transform or style its children together',
  each: 'Repeat its children once per item of a list',
  grid: 'Repeat its children in rows and columns, once per whole unit of a count',
  rect: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  line: 'Line',
  path: 'Path: SVG path data, with numbers in {braces} from expressions',
  polygon: 'Closed shape through a list of points',
  polyline: 'Open line through a list of points',
  text: 'Text',
  animate: 'Animate one attribute of the shape it sits in',
  animateTransform: 'Move, turn, scale or skew the shape it sits in',
}

/**
 * Node types and the project's components. Click to add a node, or drag one
 * onto the graph to place it.
 */
export function Palette({
  components,
  usage,
  nested = false,
  onAdd,
}: {
  /** Components that can be used here (the ones on the trail of entered components are left out), with their ids. */
  components: readonly { name: string; id: string }[]
  /** Where each component is used, for the counts next to their names. */
  usage: Usage
  /** Inside an entered definition: the left-out components are further up the trail. */
  nested?: boolean
  onAdd: (item: PaletteItem) => void
}) {
  const item = (entry: PaletteItem, label: ReactNode, title: string) => (
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
            {nested
              ? 'The other components are open further up the trail; using one here would make a loop.'
              : 'No other components in this project yet.'}
          </p>
        ) : (
          <ul>
            {components.map(({ name, id }) => {
              const uses = usageCount(usage, name)
              return item(
                { type: 'component', ref: id },
                <>
                  {name}
                  {uses > 0 && (
                    <span
                      className="palette-uses"
                      aria-label={`used ${uses} times`}
                    >
                      {uses}
                    </span>
                  )}
                </>,
                `An instance of ${name}${uses > 0 ? ` (used ${uses}× in this project)` : ''}`,
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
