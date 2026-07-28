/**
 * Workflows Module - SLA breach routing (pure)
 *
 * Resolves what happens to a run when a USER_TASK's deadline passes, from the
 * definition alone — deliberately shaped like `lib/error-routing.ts`, which
 * answers the same kind of question for a failed step:
 *
 *   1. an outgoing transition marked `kind: 'slaBreach'` wins — the canvas form
 *      of "route the breach";
 *   2. otherwise the step's `onBreach` action applies (`route` bound to a
 *      durable transition id, `reassign`, or `notify`);
 *   3. otherwise nothing routes, which is exactly today's behavior.
 *
 * Every fall-through is FAIL-SAFE: an `onBreach: { action: 'route' }` whose
 * transition no longer exists on this step resolves to `none`, never to
 * "follow whichever route happens to be valid". Auto-routing a breach would
 * advance the run past work the author never said could be skipped — the
 * opposite of what a deadline means.
 *
 * PURE: no ORM, DI, React or registry imports. Engine call sites pass the plain
 * definition JSON.
 */

import type { TaskOnBreach } from '../data/validators'

export const SLA_BREACH_TRANSITION_KIND = 'slaBreach'

/**
 * Canvas handle id a USER_TASK node exposes for its SLA-breach output, mirroring
 * `ERROR_SOURCE_HANDLE_ID`. A connection drawn from it compiles to a transition
 * with `kind: 'slaBreach'`.
 */
export const SLA_BREACH_SOURCE_HANDLE_ID = 'slaBreach'

export interface BreachRoutingTransitionLike {
  transitionId?: string
  fromStepId?: string
  toStepId?: string
  kind?: string
  priority?: number
}

export interface BreachRoutingDefinitionLike {
  transitions?: BreachRoutingTransitionLike[]
}

export type TaskBreachHandling =
  | { kind: 'route'; transition: BreachRoutingTransitionLike }
  | { kind: 'reassign'; assignedTo: string | null; assignedToRoles: string[] | null }
  | { kind: 'notify' }
  | { kind: 'none' }

/**
 * A transition authored as the SLA-breach route. The discriminator is the same
 * additive optional `kind` field error routes use, so every stored definition
 * keeps its current meaning.
 */
export function isSlaBreachTransition(
  transition: BreachRoutingTransitionLike | null | undefined
): boolean {
  return transition?.kind === SLA_BREACH_TRANSITION_KIND
}

/**
 * SLA-breach routes must never be taken by normal routing — they are reachable
 * only from a breach, exactly like error routes. Every routing lookup filters
 * through this helper.
 */
export function excludeSlaBreachTransitions<T extends BreachRoutingTransitionLike>(
  transitions: T[]
): T[] {
  return transitions.filter((transition) => !isSlaBreachTransition(transition))
}

/**
 * Highest-priority outgoing SLA-breach route of a step. Ties keep definition
 * order, mirroring how `findValidTransitions` orders normal routes.
 */
export function findSlaBreachTransition(
  definition: BreachRoutingDefinitionLike | null | undefined,
  stepId: string
): BreachRoutingTransitionLike | null {
  const candidates = (definition?.transitions ?? []).filter(
    (transition) => transition.fromStepId === stepId && isSlaBreachTransition(transition)
  )
  if (candidates.length === 0) return null
  const ordered = [...candidates].sort((left, right) => (right.priority || 0) - (left.priority || 0))
  return ordered[0] ?? null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The inspector's "Reassign to" field accepts a user id OR a role, which is
 * what its placeholder promises. A UUID addresses one person (`assigned_to`
 * holds a bare user id); anything else is a role NAME, which is the vocabulary
 * `assigned_to_roles` has always spoken.
 */
export function resolveBreachReassignTarget(
  reassignTo: string | null | undefined
): { assignedTo: string | null; assignedToRoles: string[] | null } | null {
  const target = typeof reassignTo === 'string' ? reassignTo.trim() : ''
  if (!target.length) return null
  if (UUID_PATTERN.test(target)) return { assignedTo: target, assignedToRoles: null }
  return { assignedTo: null, assignedToRoles: [target] }
}

/**
 * The single decision point for a breached task, in precedence order:
 * wired SLA-breach route → the step's `onBreach` action → nothing.
 *
 * `none` is both the "author configured nothing" case and every malformed
 * configuration, so a definition that predates this feature — or one whose
 * breach route was deleted — behaves precisely as it did before.
 */
export function resolveTaskBreachHandling(
  definition: BreachRoutingDefinitionLike | null | undefined,
  stepId: string,
  onBreach: TaskOnBreach | null | undefined
): TaskBreachHandling {
  const wired = findSlaBreachTransition(definition, stepId)
  if (wired) return { kind: 'route', transition: wired }

  const action = onBreach?.action
  if (action === 'route') {
    const bound = (definition?.transitions ?? []).find(
      (transition) =>
        transition.transitionId === onBreach?.transitionId &&
        transition.fromStepId === stepId
    )
    return bound ? { kind: 'route', transition: bound } : { kind: 'none' }
  }

  if (action === 'reassign') {
    const target = resolveBreachReassignTarget(onBreach?.reassignTo)
    return target ? { kind: 'reassign', ...target } : { kind: 'none' }
  }

  if (action === 'notify') return { kind: 'notify' }

  return { kind: 'none' }
}
