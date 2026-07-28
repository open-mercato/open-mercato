import { useState } from 'react'
import { BaseEdge, EdgeProps, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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
  const t = useT()
  const [hovered, setHovered] = useState(false)
  // An error route (spec 5.9) always renders in its own state: the persisted
  // `state` field tracks run progress, the route kind is structural.
  const isErrorRoute = data?.kind === 'error'
  const state = (isErrorRoute ? 'error' : data?.state || 'pending') as EdgeState
  const errorRouteLabel = t('workflows.transitions.errorRoute', 'On error')
  const label = (data?.label as string) || (isErrorRoute ? errorRouteLabel : '')
  const colors = EDGE_COLORS[state]
  // Status is never color-only: the error route pairs its red dashed stroke with
  // a permanently visible icon+label chip, not just a hover affordance.
  const showLabel = Boolean(label) && (hovered || isErrorRoute)

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
        aria-label={isErrorRoute ? errorRouteLabel : undefined}
        style={{
          stroke: colors.stroke,
          strokeWidth: 2,
          strokeDasharray: colors.dashed ? colors.dashArray : undefined,
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
      {showLabel && (
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
