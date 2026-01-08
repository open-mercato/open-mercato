import { BaseEdge, EdgeProps, EdgeLabelRenderer, getStraightPath } from '@xyflow/react'
import { WorkflowTransitionLabel } from './WorkflowTransitionLabel'
import { EDGE_COLORS, EdgeState } from '../lib/status-colors'

export function WorkflowTransitionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const state = (data?.state || 'pending') as EdgeState
  const label = (data?.label as string) || ''
  const colors = EDGE_COLORS[state]

  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: colors.stroke,
          strokeWidth: 2,
          strokeDasharray: colors.dashed ? '5,5' : undefined,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <WorkflowTransitionLabel label={label} state={state} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
