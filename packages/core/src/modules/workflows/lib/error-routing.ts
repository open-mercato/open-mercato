/**
 * Workflows Module - Error Routing (pure)
 *
 * Resolves what happens when a step fails, from the definition alone:
 *
 *   1. an outgoing transition marked `kind: 'error'` wins — the engine follows it
 *      instead of failing the instance (spec 5.9 "error output handle");
 *   2. otherwise the failed step's `errorDirective` applies
 *      (`fail` | `continueWithFallback` | `failureQueue`);
 *   3. otherwise the instance fails exactly as it does today.
 *
 * Definitions carrying neither an error transition nor a directive resolve to
 * `fail`, which is the untouched legacy path — this module is the single place
 * that decides, so the "no error config ⇒ identical trace" guarantee is testable.
 *
 * PURE: no ORM, DI, React or registry imports. Engine call sites pass the plain
 * definition JSON.
 */

export const ERROR_TRANSITION_KIND = 'error'

/**
 * Canvas handle id every activity-bearing node exposes for its error output. A
 * connection drawn from it compiles to a transition with `kind: 'error'`. Lives
 * in this pure module so `graph-utils` can read it without pulling the React
 * component chain (enforced by the xyflow import-boundary test).
 */
export const ERROR_SOURCE_HANDLE_ID = 'error'

/**
 * Run-context key carrying the failure that caused an error route to be taken,
 * so the handling branch can render/forward it. Engine-owned and reserved
 * against user context writes.
 */
export const WORKFLOW_ERROR_CONTEXT_KEY = '__error'

export interface WorkflowErrorContextEntry {
  stepId: string
  message: string
  occurredAt: string
}

export function buildErrorContextEntry(stepId: string, message: string): WorkflowErrorContextEntry {
  return { stepId, message, occurredAt: new Date().toISOString() }
}

export type WorkflowErrorDirectiveMode = 'fail' | 'continueWithFallback' | 'failureQueue'

export interface ErrorRoutingTransitionLike {
  transitionId?: string
  fromStepId?: string
  toStepId?: string
  kind?: string
  priority?: number
}

export interface ErrorRoutingStepLike {
  stepId?: string
  errorDirective?: {
    mode?: string
    fallbackValue?: unknown
  } | null
}

export interface ErrorRoutingErrorHandlerLike {
  workflowId?: string
  version?: number
  stepId?: string
}

export interface ErrorRoutingDefinitionLike {
  steps?: ErrorRoutingStepLike[]
  transitions?: ErrorRoutingTransitionLike[]
  errorHandler?: ErrorRoutingErrorHandlerLike | null
}

export type StepFailureHandling =
  | { kind: 'route'; transition: ErrorRoutingTransitionLike }
  | { kind: 'continue'; fallbackValue?: unknown }
  | { kind: 'park' }
  | { kind: 'handlerStep'; stepId: string }
  | { kind: 'fail' }

export interface ErrorRouteIssue {
  code: 'ERROR_ROUTE_DUPLICATE_TARGET' | 'ERROR_ROUTE_UNKNOWN_TARGET' | 'ERROR_ROUTE_UNKNOWN_SOURCE'
  message: string
  transitionId?: string
  stepId?: string
}

/**
 * A transition authored as an error route. The discriminator is the additive
 * optional `kind` field: absent (or any other value) means a normal route, so
 * every stored definition keeps its current meaning.
 */
export function isErrorTransition(transition: ErrorRoutingTransitionLike | null | undefined): boolean {
  return transition?.kind === ERROR_TRANSITION_KIND
}

/**
 * Error routes must never be taken by normal routing — they are only reachable
 * from a failure. Every routing lookup filters through this helper.
 */
export function excludeErrorTransitions<T extends ErrorRoutingTransitionLike>(transitions: T[]): T[] {
  return transitions.filter((transition) => !isErrorTransition(transition))
}

/**
 * Highest-priority outgoing error route of a step. Ties keep definition order,
 * mirroring how `findValidTransitions` orders normal routes.
 */
export function findErrorTransition(
  definition: ErrorRoutingDefinitionLike | null | undefined,
  stepId: string
): ErrorRoutingTransitionLike | null {
  const transitions = definition?.transitions ?? []
  const candidates = transitions.filter(
    (transition) => transition.fromStepId === stepId && isErrorTransition(transition)
  )
  if (candidates.length === 0) return null
  const ordered = [...candidates].sort((a, b) => (b.priority || 0) - (a.priority || 0))
  return ordered[0] ?? null
}

export function readStepErrorDirective(
  definition: ErrorRoutingDefinitionLike | null | undefined,
  stepId: string
): { mode: WorkflowErrorDirectiveMode; fallbackValue?: unknown } | null {
  const step = (definition?.steps ?? []).find((candidate) => candidate.stepId === stepId)
  const directive = step?.errorDirective
  if (!directive) return null
  const mode = directive.mode
  if (mode !== 'fail' && mode !== 'continueWithFallback' && mode !== 'failureQueue') return null
  return { mode, fallbackValue: directive.fallbackValue }
}

/**
 * Definition-level catch-all handler (spec 5.9). Returns null unless exactly one
 * form is declared, so a malformed handler degrades to today's behavior instead
 * of guessing.
 */
export function readWorkflowErrorHandler(
  definition: ErrorRoutingDefinitionLike | null | undefined
): { workflowId: string; version?: number } | { stepId: string } | null {
  const handler = definition?.errorHandler
  if (!handler) return null
  const hasWorkflow = typeof handler.workflowId === 'string' && handler.workflowId.length > 0
  const hasStep = typeof handler.stepId === 'string' && handler.stepId.length > 0
  if (hasWorkflow === hasStep) return null
  if (hasWorkflow) {
    return { workflowId: handler.workflowId as string, version: handler.version }
  }
  return { stepId: handler.stepId as string }
}

/**
 * The single decision point for a failed step, in precedence order:
 * wired error route → step directive → definition-level handler step → fail.
 * The handler step comes last because it is a catch-all, and a step never jumps
 * to itself, which is the recursion guard for the in-instance handler form.
 * `fail` is both the explicit directive and the absent-config default, so legacy
 * definitions never diverge.
 */
export function resolveStepFailureHandling(
  definition: ErrorRoutingDefinitionLike | null | undefined,
  stepId: string
): StepFailureHandling {
  const errorTransition = findErrorTransition(definition, stepId)
  if (errorTransition) return { kind: 'route', transition: errorTransition }

  const directive = readStepErrorDirective(definition, stepId)
  if (directive?.mode === 'continueWithFallback') {
    return { kind: 'continue', fallbackValue: directive.fallbackValue }
  }
  if (directive?.mode === 'failureQueue') return { kind: 'park' }

  const handler = readWorkflowErrorHandler(definition)
  if (handler && 'stepId' in handler && handler.stepId !== stepId) {
    return { kind: 'handlerStep', stepId: handler.stepId }
  }

  return { kind: 'fail' }
}

/**
 * Author-time checks surfaced by the Problems panel. An error route sharing its
 * source AND target with a normal route is rejected because the engine resolves
 * a followed route by its `(fromStepId, toStepId)` pair — the pair would be
 * ambiguous and the wrong activities could run.
 */
export function validateErrorRoutes(
  definition: ErrorRoutingDefinitionLike | null | undefined
): ErrorRouteIssue[] {
  const issues: ErrorRouteIssue[] = []
  const transitions = definition?.transitions ?? []
  const stepIds = new Set((definition?.steps ?? []).map((step) => step.stepId).filter(Boolean))

  for (const transition of transitions) {
    if (!isErrorTransition(transition)) continue

    if (transition.fromStepId && stepIds.size > 0 && !stepIds.has(transition.fromStepId)) {
      issues.push({
        code: 'ERROR_ROUTE_UNKNOWN_SOURCE',
        message: `Error route ${transition.transitionId ?? ''} starts at unknown step ${transition.fromStepId}`,
        transitionId: transition.transitionId,
        stepId: transition.fromStepId,
      })
    }

    if (transition.toStepId && stepIds.size > 0 && !stepIds.has(transition.toStepId)) {
      issues.push({
        code: 'ERROR_ROUTE_UNKNOWN_TARGET',
        message: `Error route ${transition.transitionId ?? ''} targets unknown step ${transition.toStepId}`,
        transitionId: transition.transitionId,
        stepId: transition.toStepId,
      })
    }

    const collides = transitions.some(
      (other) =>
        !isErrorTransition(other) &&
        other.fromStepId === transition.fromStepId &&
        other.toStepId === transition.toStepId
    )
    if (collides) {
      issues.push({
        code: 'ERROR_ROUTE_DUPLICATE_TARGET',
        message: `Error route ${transition.transitionId ?? ''} shares its source and target with a normal route`,
        transitionId: transition.transitionId,
        stepId: transition.fromStepId,
      })
    }
  }

  return issues
}
