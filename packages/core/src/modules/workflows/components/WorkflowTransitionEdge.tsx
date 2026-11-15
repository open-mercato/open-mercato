import { useState } from 'react'
import { BaseEdge, EdgeProps, EdgeLabelRenderer, getBezierPath, useStore } from '@xyflow/react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { WorkflowTransitionLabel } from './WorkflowTransitionLabel'
import { WorkflowRouteChips } from './WorkflowRouteChips'
import { EDGE_COLORS, EdgeState } from '../lib/status-colors'
import { buildRouteChipModel, routeCarriesCondition, ROUTE_CHIP_ZOOM_THRESHOLD, type RouteChipSection } from '../lib/route-chips'
import { requestRouteActivityEdit, requestRouteChipSection } from '../lib/route-chip-events'

export function WorkflowTransitionEdge({
  id,
  source,
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

  // Semantic zoom (spec 4.4): the chip row collapses to dots when the canvas is
  // zoomed out, so a 60-node flow reads as structure instead of a wall of text.
  const isZoomedOut = useStore((store) => store.transform[2] < ROUTE_CHIP_ZOOM_THRESHOLD)
  // `otherwise` is relative to the siblings leaving the same step. The selector
  // returns a boolean so this edge only re-renders when the answer flips.
  const hasConditionedSibling = useStore((store) =>
    store.edges.some(
      (edge) =>
        edge.source === source
        && edge.id !== id
        && edge.data?.kind !== 'error'
        && routeCarriesCondition(edge.data ?? {}),
    ),
  )

  const chipModel = buildRouteChipModel({
    condition: data?.condition,
    preConditions: data?.preConditions,
    activities: data?.activities,
    hasConditionedSibling,
  })
  const showChips = !isErrorRoute && !chipModel.isEmpty

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const openSection = (section: RouteChipSection) => requestRouteChipSection(id, section)
  const openActivity = (activityId: string) => requestRouteActivityEdit(id, activityId)

  // Spec section 4.6: a route is a graph element a screen reader must be able to
  // name. An error route says so, a labelled route reads its label, and an
  // unlabelled one still announces that it is a route rather than a bare path.
  const routeAriaLabel = isErrorRoute
    ? errorRouteLabel
    : label
      ? t('workflows.visualEditor.routeLabelled', 'Route: {label}', { label })
      : t('workflows.visualEditor.routeUnlabelled', 'Route')

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        role="img"
        aria-label={routeAriaLabel}
        style={{
          stroke: colors.stroke,
          strokeWidth: colors.strokeWidth,
          strokeDasharray: colors.dashed ? colors.dashArray : undefined,
        }}
      />
      {/* Invisible hit path. Deliberately independent of the visible stroke
          width: thinning the wire must not make a route harder to grab for
          selection or endpoint reattachment. */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {(showLabel || showChips) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: showChips ? 'all' : 'none',
              // Overlay the label above node cards when the tight layout makes the
              // midpoint pill overlap a neighbour. The viewport is the stacking
              // context and selected nodes elevate to ~1000, so sit clearly above.
              zIndex: 1500,
            }}
            className="nodrag nopan flex flex-col items-center gap-1"
          >
            {showLabel ? <WorkflowTransitionLabel label={label} state={state} /> : null}
            {showChips ? (
              <WorkflowRouteChips model={chipModel} collapsed={isZoomedOut} onOpenSection={openSection} onOpenActivity={openActivity} />
            ) : null}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
