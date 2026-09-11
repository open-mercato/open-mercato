/**
 * Workflows Module - Route Priority (pure)
 *
 * Spec 2026-07-26-workflows-ux-redesign.md section 4.4: "Priority becomes
 * drag-to-reorder of a node's outgoing routes; the number is derived and
 * demoted to advanced. First edit of a node's routes runs a priority
 * normalization pass (existing definitions mix dialog-default 100 with
 * schema-default 0)."
 *
 * The engine is untouched: `findValidTransitions` still evaluates outgoing
 * transitions highest-priority-first with ties keeping definition order. This
 * module only decides which NUMBERS express a given author-visible ORDER, and
 * the normalization pass rewrites messy legacy numbers into clean ones WITHOUT
 * changing that evaluation order.
 *
 * Error routes (`kind: 'error'`) are never part of normal-route ordering — they
 * are only reachable from a failure, so their priority means something else
 * entirely (`findErrorTransition`). They pass through untouched.
 *
 * PURE: no React, no ORM, no DI. The only xyflow dependency is the `Edge` type.
 */

import type { Edge } from '@xyflow/react'
import { isNonNormalRouteKind } from './route-kinds'
import { routeCarriesCondition } from './route-chips'

/** Priority of the highest route when a node has at most 10 normal routes. */
export const ROUTE_PRIORITY_TOP = 100

/** Gap between consecutive routes, matching the Switch compiler (step 2.2). */
export const ROUTE_PRIORITY_STEP = 10

/** The trailing unconditioned route always evaluates last. */
export const ROUTE_PRIORITY_OTHERWISE = 0

export interface RouteOrderEntry {
  transitionId: string
  toStepId: string
  label?: string
  priority: number
  hasCondition: boolean
  isOtherwise: boolean
}

interface EdgeDataLike {
  priority?: number
  condition?: unknown
  preConditions?: unknown
  transitionName?: string
  label?: string
  kind?: string
}

function edgeData(edge: Edge): EdgeDataLike {
  return (edge.data ?? {}) as EdgeDataLike
}

function readPriority(edge: Edge): number {
  const raw = edgeData(edge).priority
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

/**
 * A node's outgoing NORMAL routes — every kinded route (error, SLA-breach,
 * agent outcome) and data-mapping edge excluded. Filtering only error routes
 * here used to let a breach or outcome route into the priority ladder, where it
 * would read as a happy path the author never wired.
 */
export function outgoingNormalRoutes(edges: Edge[], nodeId: string): Edge[] {
  return edges.filter(
    (edge) =>
      edge.source === nodeId &&
      edge.type !== 'workflowDataMapping' &&
      !isNonNormalRouteKind(edgeData(edge).kind),
  )
}

/**
 * The order the engine evaluates a node's routes in today: priority descending,
 * ties keeping definition order. Implemented as an index-decorated comparison so
 * it stays stable on every runtime, with an explicit comparator (#3620).
 */
export function orderRoutesByPriority(routes: Edge[]): Edge[] {
  return routes
    .map((edge, index) => ({ edge, index, priority: readPriority(edge) }))
    .sort((a, b) => (b.priority - a.priority) || (a.index - b.index))
    .map((entry) => entry.edge)
}

/**
 * Derived priorities for an ordered route list. The last route is the
 * "otherwise" — and gets priority 0 — only when it carries no condition while an
 * earlier one does; otherwise every route keeps a positive, evenly spaced slot.
 * The top value grows with the route count so a node with more than ten routes
 * still gets unique, non-negative numbers.
 */
export function derivePriorities(entries: Array<{ hasCondition: boolean }>): number[] {
  const count = entries.length
  if (count === 0) return []

  const lastIndex = count - 1
  const hasConditionedRoute = entries.some((entry) => entry.hasCondition)
  const trailingOtherwise = count > 1 && hasConditionedRoute && !entries[lastIndex].hasCondition
  const caseCount = trailingOtherwise ? lastIndex : count
  const top = Math.max(ROUTE_PRIORITY_TOP, caseCount * ROUTE_PRIORITY_STEP)

  return entries.map((_entry, index) => {
    if (trailingOtherwise && index === lastIndex) return ROUTE_PRIORITY_OTHERWISE
    return top - index * ROUTE_PRIORITY_STEP
  })
}

/** The inspector's view of a node's outgoing routes, in evaluation order. */
export function readRouteOrder(edges: Edge[], nodeId: string): RouteOrderEntry[] {
  const ordered = orderRoutesByPriority(outgoingNormalRoutes(edges, nodeId))
  const hasConditionedRoute = ordered.some((edge) => routeCarriesCondition(edgeData(edge)))
  const lastIndex = ordered.length - 1

  return ordered.map((edge, index) => {
    const data = edgeData(edge)
    const hasCondition = routeCarriesCondition(data)
    return {
      transitionId: edge.id,
      toStepId: edge.target,
      label: data.transitionName || data.label || undefined,
      priority: readPriority(edge),
      hasCondition,
      isOtherwise: !hasCondition && hasConditionedRoute && index === lastIndex && ordered.length > 1,
    }
  })
}

/** Move one route within the list, returning a new array (drag-to-reorder). */
export function moveRoute(entries: RouteOrderEntry[], fromIndex: number, toIndex: number): RouteOrderEntry[] {
  if (fromIndex === toIndex) return entries
  if (fromIndex < 0 || fromIndex >= entries.length) return entries
  const clampedTo = Math.min(Math.max(toIndex, 0), entries.length - 1)
  const next = [...entries]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(clampedTo, 0, moved)
  return next
}

/** Re-derive priorities so the entries read top-to-bottom in evaluation order. */
export function applyDerivedPriorities(entries: RouteOrderEntry[]): RouteOrderEntry[] {
  const priorities = derivePriorities(entries)
  return entries.map((entry, index) => ({
    ...entry,
    priority: priorities[index],
    isOtherwise: priorities[index] === ROUTE_PRIORITY_OTHERWISE && !entry.hasCondition && entries.length > 1,
  }))
}

/** Write an inspector route list back onto the node's outgoing edges. */
export function applyRouteOrder(edges: Edge[], nodeId: string, entries: RouteOrderEntry[]): Edge[] {
  const priorityByTransitionId = new Map(entries.map((entry) => [entry.transitionId, entry.priority]))
  return edges.map((edge) => {
    if (edge.source !== nodeId) return edge
    if (!priorityByTransitionId.has(edge.id)) return edge
    return { ...edge, data: { ...(edge.data ?? {}), priority: priorityByTransitionId.get(edge.id) } }
  })
}

/**
 * True when a node's outgoing routes still carry legacy numbering — duplicated
 * priorities (the dialog default of 100 on every route) or values off the
 * derived scale. A single route never needs normalizing.
 */
export function needsPriorityNormalization(edges: Edge[], nodeId: string): boolean {
  const entries = readRouteOrder(edges, nodeId)
  if (entries.length < 2) return false
  const derived = derivePriorities(entries)
  return entries.some((entry, index) => entry.priority !== derived[index])
}

/**
 * Whether the normalization pass may run for a definition of this `source`.
 *
 * A `code` definition is authored in TypeScript and is read-only in the editor —
 * rewriting its priorities would silently diverge the canvas from the code. It
 * becomes normalizable only after Customize, which mints an editable override
 * (`code_override`), which is exactly the spec's "for `source: 'code'`
 * definitions this happens only on Customize".
 */
export function canNormalizeRoutePriorities(source: string | null | undefined): boolean {
  return source !== 'code'
}

/**
 * The normalization pass: rewrite a node's outgoing normal-route priorities to
 * clean descending values while PRESERVING the order the engine evaluates them
 * in today. Idempotent, and a no-op for a node whose routes are already clean.
 */
export function normalizeRoutePriorities(edges: Edge[], nodeId: string): Edge[] {
  if (!needsPriorityNormalization(edges, nodeId)) return edges
  return applyRouteOrder(edges, nodeId, applyDerivedPriorities(readRouteOrder(edges, nodeId)))
}
