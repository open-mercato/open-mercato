/**
 * Workflows Module - Route kind round-trip (pure)
 *
 * A transition's `kind` is what keeps a route off the happy path: `error` is
 * reachable only from a failure, `slaBreach` only from a deadline passing. Each
 * kind is drawn from its own canvas source handle, so persisting a route means
 * answering two questions in both directions:
 *
 *   canvas edge  → which `kind` does this connection compile to?
 *   stored route → which source handle does it re-attach to?
 *
 * Both answers used to be inlined per kind, which is why `slaBreach` — added
 * after `error` — was silently downgraded to a normal transition the moment a
 * definition carrying one was opened in the Studio and saved: `graphToDefinition`
 * only ever special-cased `'error'`. Registering a kind here is now the single
 * step that makes it survive the round trip, so the next kind cannot repeat it.
 *
 * PURE: no ORM, DI, React or registry imports, so `graph-utils` can consume it
 * without pulling the editor's render chain (enforced by the xyflow
 * import-boundary test).
 */

import { ERROR_SOURCE_HANDLE_ID, ERROR_TRANSITION_KIND } from './error-routing'
import { SLA_BREACH_SOURCE_HANDLE_ID, SLA_BREACH_TRANSITION_KIND } from './breach-routing'
import {
  OUTCOME_TRANSITION_KIND,
  isAgentOutcomeKind,
  outcomeSourceHandleId,
  parseOutcomeSourceHandleId,
} from './outcome-routing'

/**
 * The absent form. A transition with no `kind` and a transition with
 * `kind: 'normal'` mean the same thing to every routing lookup, so the canvas
 * serializes both as absent — which is what keeps a definition declaring no
 * kinds byte-identical through a save.
 */
export const NORMAL_TRANSITION_KIND = 'normal'

/**
 * The canvas source handle a normal route leaves from — every node's ordinary
 * output, and the one handle no `RouteKindDescriptor` claims.
 *
 * FROZEN: stored transitions re-attach to it by id (`definitionToGraph` emits
 * no `sourceHandle` for a normal route, which React Flow resolves to the node's
 * only unnamed source), and moving where it RENDERS must never change what it
 * is called. It moved into the outcome-row footer so every outgoing connection
 * leaves from a row; the id did not move with it.
 */
export const DEFAULT_SOURCE_HANDLE_ID = 'source'

export interface RouteKindTransitionLike {
  kind?: string
  outcomeKind?: string
}

export interface RouteKindDescriptor {
  /** Value persisted as `transition.kind`. */
  kind: string
  /** True when a connection drawn from this handle compiles to this kind. */
  matchesSourceHandle(sourceHandleId: string): boolean
  /** Canvas source handle a stored transition of this kind re-attaches to. */
  resolveSourceHandle(transition: RouteKindTransitionLike): string
  /**
   * Fields beyond `kind` this route persists, derived from what the canvas
   * carries. A kind whose handles fan out (outcome routes) stores WHICH handle
   * it was drawn from; a fixed-handle kind stores nothing extra.
   */
  discriminatorFields(edge: RouteKindEdgeLike): Record<string, unknown>
}

export interface RouteKindEdgeLike {
  data?: RouteKindTransitionLike | null
  sourceHandle?: string | null
}

function fixedHandleDescriptor(kind: string, sourceHandleId: string): RouteKindDescriptor {
  return {
    kind,
    matchesSourceHandle: (candidate) => candidate === sourceHandleId,
    resolveSourceHandle: () => sourceHandleId,
    discriminatorFields: () => ({}),
  }
}

/**
 * Outcome routes are the one kind that fans out: an agent node exposes a handle
 * per §7.2 disposition kind, so the handle carries the outcome and the stored
 * route carries it back as `outcomeKind`. `approved` is the fallback because it
 * is the outcome §7.2 renders unconditionally.
 */
const outcomeDescriptor: RouteKindDescriptor = {
  kind: OUTCOME_TRANSITION_KIND,
  matchesSourceHandle: (candidate) => parseOutcomeSourceHandleId(candidate) !== null,
  resolveSourceHandle: (transition) =>
    outcomeSourceHandleId(
      isAgentOutcomeKind(transition.outcomeKind) ? transition.outcomeKind : 'approved',
    ),
  discriminatorFields: (edge) => {
    const carried = edge.data?.outcomeKind
    const fromHandle = parseOutcomeSourceHandleId(edge.sourceHandle)
    const outcome = isAgentOutcomeKind(carried) ? carried : fromHandle
    return { outcomeKind: outcome ?? 'approved' }
  },
}

/**
 * Every non-normal kind the canvas can author. Order is only the lookup order:
 * handle ids are disjoint, so at most one descriptor ever matches.
 */
const ROUTE_KIND_DESCRIPTORS: RouteKindDescriptor[] = [
  fixedHandleDescriptor(ERROR_TRANSITION_KIND, ERROR_SOURCE_HANDLE_ID),
  fixedHandleDescriptor(SLA_BREACH_TRANSITION_KIND, SLA_BREACH_SOURCE_HANDLE_ID),
  outcomeDescriptor,
]

export function listRouteKindDescriptors(): RouteKindDescriptor[] {
  return [...ROUTE_KIND_DESCRIPTORS]
}

/** Descriptor for a stored `transition.kind`, or null for normal / unknown kinds. */
export function findRouteKindDescriptor(kind: unknown): RouteKindDescriptor | null {
  if (typeof kind !== 'string' || kind.length === 0) return null
  return ROUTE_KIND_DESCRIPTORS.find((descriptor) => descriptor.kind === kind) ?? null
}

/** Descriptor for a canvas source handle, or null when the handle is the default one. */
export function findRouteKindDescriptorForHandle(sourceHandleId: unknown): RouteKindDescriptor | null {
  if (typeof sourceHandleId !== 'string' || sourceHandleId.length === 0) return null
  return ROUTE_KIND_DESCRIPTORS.find((descriptor) => descriptor.matchesSourceHandle(sourceHandleId)) ?? null
}

/**
 * The kind a canvas edge compiles to, from its carried `data.kind` and the
 * handle it leaves from. Returns null for a normal route, which is what makes
 * "no kind config ⇒ identical serialization" the default rather than a case.
 *
 * The carried kind wins over the handle so a route authored before its handle
 * existed still serializes as its kind.
 */
export function resolveEdgeRouteKind(
  edgeKind: unknown,
  sourceHandleId: unknown,
): RouteKindDescriptor | null {
  return findRouteKindDescriptor(edgeKind) ?? findRouteKindDescriptorForHandle(sourceHandleId)
}

/** True for any route the engine reaches only through its own dedicated path. */
export function isNonNormalRouteKind(kind: unknown): boolean {
  return findRouteKindDescriptor(kind) !== null
}

/**
 * Strip every kinded route from a normal-routing lookup.
 *
 * Each kind is reachable ONLY from its own trigger — a failure, a passed
 * deadline, a resolved disposition — so a routing lookup that forgot one would
 * auto-select it as a happy path. That is the bug shape `route-priority.ts`
 * already had for `slaBreach`, so the filter lives here once and every lookup
 * calls it instead of composing per-kind excludes and eventually missing one.
 */
export function excludeNonNormalTransitions<T extends { kind?: string }>(
  transitions: T[],
): T[] {
  return transitions.filter((transition) => !isNonNormalRouteKind(transition?.kind))
}
