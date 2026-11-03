/**
 * Compensation ghosts (spec section 4.4: "compensation ghosts — dashed reverse,
 * behind a toggle").
 *
 * Compensation is modelled per ACTIVITY (`activity.compensation.activityId`) and
 * executed LIFO by `lib/compensation-handler.ts` when a run fails. Until now the
 * canvas rendered none of it, so an author could not see that leaving a step
 * schedules undo work. These helpers derive that picture — and nothing else:
 * this is READ-ONLY visualization, there is no engine change and a ghost is
 * never a transition.
 *
 * A route's activities run on the way OUT of its source step, so the step that
 * owns compensable work is the route's SOURCE and the undo walks back along the
 * route in reverse — which is exactly the edge these helpers mint
 * (`target -> source`).
 *
 * PURE: plain edges in, plain edges out. Rendering, translation and the toggle
 * live in the canvas.
 */

import type { Edge } from '@xyflow/react'

/** Edge type registered on the canvas for a ghost. Never a transition type. */
export const WORKFLOW_COMPENSATION_GHOST_EDGE_TYPE = 'workflowCompensationGhost'

/**
 * Ghost ids are prefixed so a ghost is recognisable without consulting its type,
 * which is what lets `graphToDefinition` refuse to serialize one even if a ghost
 * ever reached it.
 */
export const COMPENSATION_GHOST_EDGE_ID_PREFIX = 'compensation-ghost:'

export interface CompensationGhostEdgeData extends Record<string, unknown> {
  /** The route whose activities declare the compensation. */
  transitionId: string
  /** Ids of the compensating activities, in declaration order. */
  compensationActivityIds: string[]
  /** Display names of the compensated activities, in declaration order. */
  compensatedActivityNames: string[]
}

type ActivityLike = {
  activityId?: unknown
  activityName?: unknown
  compensation?: { activityId?: unknown } | null
}

function readActivities(edge: Edge): ActivityLike[] {
  const activities = (edge.data as { activities?: unknown } | undefined)?.activities
  return Array.isArray(activities) ? (activities as ActivityLike[]) : []
}

function readCompensationActivityId(activity: ActivityLike): string | null {
  const compensationId = activity.compensation?.activityId
  return typeof compensationId === 'string' && compensationId.length > 0 ? compensationId : null
}

function describeActivity(activity: ActivityLike): string {
  if (typeof activity.activityName === 'string' && activity.activityName.length > 0) return activity.activityName
  if (typeof activity.activityId === 'string' && activity.activityId.length > 0) return activity.activityId
  return ''
}

export function isCompensationGhostEdge(edge: Edge): boolean {
  return edge.type === WORKFLOW_COMPENSATION_GHOST_EDGE_TYPE
    || edge.id.startsWith(COMPENSATION_GHOST_EDGE_ID_PREFIX)
}

export interface CompensationRoute {
  transitionId: string
  /** Step the route leaves — the owner of the compensable activities. */
  fromStepId: string
  /** Step the route enters — where the undo path starts. */
  toStepId: string
  compensationActivityIds: string[]
  compensatedActivityNames: string[]
}

/** Every route carrying at least one activity that declares compensation. */
export function collectCompensationRoutes(edges: Edge[]): CompensationRoute[] {
  const routes: CompensationRoute[] = []
  for (const edge of edges) {
    if (isCompensationGhostEdge(edge)) continue
    const compensationActivityIds: string[] = []
    const compensatedActivityNames: string[] = []
    for (const activity of readActivities(edge)) {
      const compensationActivityId = readCompensationActivityId(activity)
      if (!compensationActivityId) continue
      compensationActivityIds.push(compensationActivityId)
      compensatedActivityNames.push(describeActivity(activity))
    }
    if (compensationActivityIds.length === 0) continue
    routes.push({
      transitionId: edge.id,
      fromStepId: edge.source,
      toStepId: edge.target,
      compensationActivityIds,
      compensatedActivityNames,
    })
  }
  return routes
}

/** Step ids that own compensable activities — the canvas badges these nodes. */
export function compensatingStepIds(edges: Edge[]): string[] {
  const seen = new Set<string>()
  for (const route of collectCompensationRoutes(edges)) seen.add(route.fromStepId)
  return [...seen]
}

/**
 * One dashed reverse ghost per compensating route.
 *
 * The ghosts are display-only: they are minted at render time, never enter the
 * editor's edge state, and are non-interactive so they cannot be selected,
 * reattached or deleted like a real route.
 */
export function buildCompensationGhostEdges(edges: Edge[]): Edge[] {
  return collectCompensationRoutes(edges).map((route) => ({
    id: `${COMPENSATION_GHOST_EDGE_ID_PREFIX}${route.transitionId}`,
    source: route.toStepId,
    target: route.fromStepId,
    type: WORKFLOW_COMPENSATION_GHOST_EDGE_TYPE,
    selectable: false,
    focusable: false,
    deletable: false,
    reconnectable: false,
    data: {
      transitionId: route.transitionId,
      compensationActivityIds: route.compensationActivityIds,
      compensatedActivityNames: route.compensatedActivityNames,
    } satisfies CompensationGhostEdgeData,
  }))
}
