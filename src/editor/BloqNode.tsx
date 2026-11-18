import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { MAX_PARAM_LINES, NODE_WIDTH, nodeHeight, slotY } from './layout.ts'
import type { BloqFlowNode } from './layout.ts'

const SHAPES = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'polyline',
  'text',
])

/** Colour family of a node card, by what the node does. */
function family(type: string): string {
  if (type === 'each' || type === 'grid') return 'repeat'
  if (type === 'component') return 'component'
  if (SHAPES.has(type)) return 'shape'
  return 'group'
}

/**
 * A node card. Child slots are input handles on the left (in child order);
 * the output handle on the right plugs into a parent's slot. The last slot is
 * always empty, for adding a child.
 */
export function BloqNode({ data, selected }: NodeProps<BloqFlowNode>) {
  const shown = data.params.slice(0, MAX_PARAM_LINES)
  const hidden = data.params.length - shown.length
  const problems = data.problems.length
  const classes = [
    'bloq',
    `bloq-${family(data.type)}`,
    problems > 0 && 'has-problems',
    selected && 'selected',
  ]

  return (
    <div
      className={classes.filter(Boolean).join(' ')}
      style={{ width: NODE_WIDTH, height: nodeHeight(data) }}
      title={problems > 0 ? data.problems.join('\n') : undefined}
    >
      <header className="bloq-header">
        <span
          className={`bloq-type${data.ref && !data.refName ? ' missing' : ''}`}
        >
          {data.ref === undefined
            ? data.type
            : (data.refName ?? (data.ref ? 'missing component' : 'component'))}
        </span>
        <span className="bloq-id">{data.id}</span>
        {problems > 0 && (
          <span
            className="bloq-problem-count"
            aria-label={`${problems} problems`}
          >
            {problems}
          </span>
        )}
      </header>
      {data.ref !== undefined && (
        <div className="bloq-kind">
          <span>component instance</span>
          {data.uses !== undefined && (
            <span
              className="bloq-uses"
              title={`${data.refName} is used ${data.uses} ${data.uses === 1 ? 'time' : 'times'} in this project. Editing it changes every instance.`}
            >
              used {data.uses}×
            </span>
          )}
        </div>
      )}
      <dl className="bloq-params">
        {shown.map((p) => (
          <div key={p.name}>
            <dt>{p.name}</dt>
            <dd>{p.value}</dd>
          </div>
        ))}
        {hidden > 0 && <div className="bloq-more">+{hidden} more</div>}
      </dl>
      {Array.from({ length: data.slots }, (_, i) => (
        <Handle
          key={i}
          type="target"
          position={Position.Left}
          id={`slot-${i}`}
          className={i === data.slots - 1 ? 'slot-empty' : undefined}
          style={{ top: slotY(i) }}
          title={
            i === data.slots - 1
              ? 'Drop a node here to add a child'
              : `Child ${i + 1}`
          }
        />
      ))}
      {!data.isRoot && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          title="Plug into a parent's slot"
        />
      )}
    </div>
  )
}
