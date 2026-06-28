import { useState } from 'react'
import { BaseEdge, EdgeProps, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react'
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
  const [hovered, setHovered] = useState(false)
  const state = (data?.state || 'pending') as EdgeState
  const label = (data?.label as string) || ''
  const colors = EDGE_COLORS[state]

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
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
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {label && hovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
              // Overlay the label above node cards when the tight layout makes the
              // midpoint pill overlap a neighbour. The viewport is the stacking
              // context and selected nodes elevate to ~1000, so sit clearly above.
              zIndex: 1500,
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
