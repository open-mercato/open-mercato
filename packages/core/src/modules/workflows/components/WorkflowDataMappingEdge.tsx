import { BaseEdge, EdgeProps, getBezierPath } from '@xyflow/react'

/**
 * WorkflowDataMappingEdge — a drag-authored SUB_WORKFLOW field mapping.
 *
 * Visually distinct from control-flow transitions: it uses the `--edge-data`
 * design token (defined on the graph container) and a dotted stroke, so a data
 * binding reads differently from a control edge at a glance. Carries no
 * transition semantics — the binding itself lives in the target step's
 * `config.inputMapping`.
 */
export function WorkflowDataMappingEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: 'var(--edge-data)',
        strokeWidth: 2,
        strokeDasharray: '2,3',
      }}
    />
  )
}
