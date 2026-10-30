/**
 * What a palette drop does to the graph (spec sections 4.2 and 4.4).
 *
 * Two drop targets, two effects:
 * - a step dropped ON A ROUTE is spliced between that route's endpoints;
 * - an action dropped ON A ROUTE is appended to that route's activities, which
 *   is what the activity chips (#4244) then render.
 *
 * A step dropped on empty canvas is just an add at the cursor and needs nothing
 * from here — `lib/node-placement.ts` already resolves the position.
 *
 * **Insert-on-route keeps the original route's data on the FIRST segment**
 * (`from → new step`). A route's condition guards LEAVING its source step and
 * its activities run on the way out, so both belong to the segment that still
 * starts where the author put them; an error route likewise stays the error path
 * out of that step. Just as importantly, the durable `transitionId` is what
 * mid-flight state resolves against (`instance.pendingTransition`,
 * `WorkflowBranchInstance.branchKey`), so it must stay attached to the segment
 * that still leaves the same step. The second segment (`new step → to`) is a
 * fresh, unconditional auto route.
 *
 * PURE: plain graph data in, plain graph data out, machine-readable rejections
 * the editor translates.
 */

import type { Node, Edge } from '@xyflow/react'
import { generateTransitionId } from './graph-utils'
import { isDataMappingEdge } from './data-edge-mapping'
import { buildWorkflowRouteEdge } from './route-edge'

export type PaletteDropRejectionCode = 'unknownRoute' | 'dataMappingRoute'

export type PaletteDropRejection = { ok: false; code: PaletteDropRejectionCode }

export type InsertStepOnRouteResult =
  | { ok: true; nodes: Node[]; edges: Edge[] }
  | PaletteDropRejection

export type AppendActivityToRouteResult =
  | { ok: true; edges: Edge[] }
  | PaletteDropRejection

export interface RouteActivity {
  activityId: string
  activityName: string
  activityType: string
  config: Record<string, unknown>
}

function routeAt(edges: Edge[], edgeId: string): Edge | undefined {
  return edges.find((edge) => edge.id === edgeId)
}

/**
 * Splice a new step into an existing route.
 *
 * The original transition is retargeted at the new step and keeps everything it
 * carried — id, label, condition, activities, priority, kind. A second,
 * unconditional route continues from the new step to the original target.
 */
export function insertStepOnRoute(
  nodes: Node[],
  edges: Edge[],
  edgeId: string,
  newNode: Node,
): InsertStepOnRouteResult {
  const route = routeAt(edges, edgeId)
  if (!route) return { ok: false, code: 'unknownRoute' }
  if (isDataMappingEdge(route)) return { ok: false, code: 'dataMappingRoute' }

  const continuation: Edge = buildWorkflowRouteEdge({
    id: generateTransitionId(),
    source: newNode.id,
    target: route.target,
    data: {
      trigger: 'auto',
      preConditions: [],
      postConditions: [],
      activities: [],
      label: '',
    },
  })

  const nextEdges = edges.flatMap((edge) =>
    edge.id === edgeId
      ? [{ ...edge, target: newNode.id, targetHandle: null }, continuation]
      : [edge],
  )

  return { ok: true, nodes: [...nodes, newNode], edges: nextEdges }
}

/** Append an action to a route's activity list (the chips render it). */
export function appendActivityToRoute(
  edges: Edge[],
  edgeId: string,
  activity: RouteActivity,
): AppendActivityToRouteResult {
  const route = routeAt(edges, edgeId)
  if (!route) return { ok: false, code: 'unknownRoute' }
  if (isDataMappingEdge(route)) return { ok: false, code: 'dataMappingRoute' }

  const data = (route.data ?? {}) as Record<string, unknown>
  const existing = Array.isArray(data.activities) ? data.activities : []

  return {
    ok: true,
    edges: edges.map((edge) =>
      edge.id === edgeId
        ? { ...edge, data: { ...data, activities: [...existing, activity] } }
        : edge,
    ),
  }
}
