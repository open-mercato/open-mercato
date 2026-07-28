/**
 * Route reattachment (spec section 4.1, issue #4233).
 *
 * Dragging a route endpoint onto another node re-targets the route instead of
 * forcing the author to delete and redraw it. The route keeps its identity —
 * the durable opaque `transitionId` minted by `generateTransitionId` — plus its
 * label, condition, activities, priority and kind, so nothing an author
 * configured is lost by moving an endpoint.
 *
 * Pure: the decision is taken over plain graph data and returns either the next
 * edge list or a machine-readable rejection code the editor translates. An
 * unaccepted reattachment simply leaves the edge list untouched, which is what
 * makes React Flow snap the dragged endpoint back to where it started.
 */

import type { Node, Edge } from '@xyflow/react'
import { graphToDefinition, validateWorkflowGraph } from './graph-utils'
import { isDataMappingEdge } from './data-edge-mapping'
import { ERROR_SOURCE_HANDLE_ID, ERROR_TRANSITION_KIND } from './error-routing'
import { validateParallelForkJoin } from '../data/validators'

/**
 * Node types that render an error output handle
 * (`components/nodes/ErrorOutputHandle.tsx`). An error route can only start at
 * one of them, so moving its source endpoint elsewhere is refused rather than
 * silently downgraded to a normal route.
 */
const ERROR_ROUTE_SOURCE_NODE_TYPES = new Set(['automated', 'userTask', 'subWorkflow', 'invokeAgent'])

export type EdgeReattachRejectionCode =
  | 'unknownRoute'
  | 'incompleteConnection'
  | 'unknownStep'
  | 'selfLoop'
  | 'duplicateRoute'
  | 'dataMappingRoute'
  | 'errorHandleUnsupported'
  | 'graphInvalid'
  | 'forkJoinInvalid'

export type EdgeReattachRejection = {
  ok: false
  code: EdgeReattachRejectionCode
  detail?: string
}

export type EdgeReattachResult =
  | { ok: true; edges: Edge[]; edge: Edge }
  | EdgeReattachRejection

export interface EdgeReattachConnection {
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

function isErrorRouteEdge(edge: Edge): boolean {
  const data = edge.data as { kind?: unknown } | undefined
  return data?.kind === ERROR_TRANSITION_KIND || edge.sourceHandle === ERROR_SOURCE_HANDLE_ID
}

function sameHandle(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left || null) === (right || null)
}

function errorMessages(nodes: Node[], edges: Edge[]): Set<string> {
  return new Set(
    validateWorkflowGraph(nodes, edges)
      .filter((issue) => issue.type === 'error')
      .map((issue) => issue.message),
  )
}

function forkJoinMessages(nodes: Node[], edges: Edge[]): Set<string> {
  return new Set(validateParallelForkJoin(graphToDefinition(nodes, edges)).map((issue) => issue.message))
}

function firstAddition(before: Set<string>, after: Set<string>): string | undefined {
  for (const message of after) {
    if (!before.has(message)) return message
  }
  return undefined
}

/**
 * Re-target one route onto a new source and/or target step.
 *
 * Route identity and every configured field survive: only the endpoints (and
 * the handles they were dropped on) change. A reattachment is refused when it
 * would create a self-loop, duplicate an existing route, move an error route
 * off a step that can raise one, or introduce a graph or fork/join violation
 * the current graph does not already have.
 */
export function reattachWorkflowEdge(
  nodes: Node[],
  edges: Edge[],
  edgeId: string,
  connection: EdgeReattachConnection,
): EdgeReattachResult {
  const existing = edges.find((edge) => edge.id === edgeId)
  if (!existing) return { ok: false, code: 'unknownRoute' }
  if (isDataMappingEdge(existing)) return { ok: false, code: 'dataMappingRoute' }

  const source = connection.source ?? null
  const target = connection.target ?? null
  if (!source || !target) return { ok: false, code: 'incompleteConnection' }

  const sourceNode = nodes.find((node) => node.id === source)
  const targetNode = nodes.find((node) => node.id === target)
  if (!sourceNode || !targetNode) return { ok: false, code: 'unknownStep' }
  if (source === target) return { ok: false, code: 'selfLoop' }

  const isErrorRoute = isErrorRouteEdge(existing)
  if (isErrorRoute && !ERROR_ROUTE_SOURCE_NODE_TYPES.has(sourceNode.type ?? '')) {
    return { ok: false, code: 'errorHandleUnsupported' }
  }

  const sourceHandle = isErrorRoute ? ERROR_SOURCE_HANDLE_ID : connection.sourceHandle ?? null
  const targetHandle = connection.targetHandle ?? null

  const duplicate = edges.some(
    (edge) =>
      edge.id !== edgeId &&
      !isDataMappingEdge(edge) &&
      edge.source === source &&
      edge.target === target &&
      sameHandle(edge.sourceHandle, sourceHandle) &&
      sameHandle(edge.targetHandle, targetHandle),
  )
  if (duplicate) return { ok: false, code: 'duplicateRoute' }

  const nextEdge: Edge = {
    ...existing,
    source,
    target,
    sourceHandle,
    targetHandle,
  }
  const nextEdges = edges.map((edge) => (edge.id === edgeId ? nextEdge : edge))

  const newGraphError = firstAddition(errorMessages(nodes, edges), errorMessages(nodes, nextEdges))
  if (newGraphError) return { ok: false, code: 'graphInvalid', detail: newGraphError }

  const newForkJoinIssue = firstAddition(forkJoinMessages(nodes, edges), forkJoinMessages(nodes, nextEdges))
  if (newForkJoinIssue) return { ok: false, code: 'forkJoinInvalid', detail: newForkJoinIssue }

  return { ok: true, edges: nextEdges, edge: nextEdge }
}
