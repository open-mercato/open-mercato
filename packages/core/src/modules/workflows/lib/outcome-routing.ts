/**
 * Workflows Module - Agent outcome routing (pure)
 *
 * Resolves where a run goes once an INVOKE_AGENT step has a disposition, from
 * the definition alone — the third member of the family `lib/error-routing.ts`
 * and `lib/breach-routing.ts` belong to, and shaped like them on purpose.
 *
 * Spec §7.2: the agent node exposes labelled output handles for a FIXED
 * platform vocabulary of five disposition kinds — `approved`, `informative`,
 * `rejected`, `guardrailBlocked`, `error` — and branching on a disposition is
 * WIRING. The alternative, enumerating handles from the selected agent's OUTCOME
 * schema, is deliberately NOT built: it would need a per-value condition on each
 * transition, which is exactly the context string-matching §7.2 exists to
 * remove. These five are governance states, not domain data.
 *
 * Precedence, per §7.2's progressive-disclosure rule:
 *
 *   1. the step declares NO outcome route at all ⇒ `default` — normal routing,
 *      byte-identical to how every definition written before this feature runs;
 *   2. an outgoing `kind: 'outcome'` route whose `outcomeKind` matches wins;
 *   3. `approved` unwired ⇒ `default`. §7.2 renders `approved` as always
 *      present ("only wired handles PLUS `approved`") because the node's default
 *      output IS the approved path — inheriting the error directive for it would
 *      fail runs whose agent simply succeeded;
 *   4. any other unwired outcome ⇒ `inherit`, the node's error directive, which
 *      is the inheritance §7.2 asks the node face to state
 *      ("unhandled → fail instance").
 *
 * Rule 1 is what keeps this additive: without it, adding one `rejected` route
 * to a step would silently change what an `informative` result does.
 *
 * PURE: no ORM, DI, React or registry imports. Engine call sites pass the plain
 * definition JSON.
 */

import {
  resolveStepFailureHandling,
  type ErrorRoutingDefinitionLike,
  type StepFailureHandling,
} from './error-routing'

export const OUTCOME_TRANSITION_KIND = 'outcome'

/**
 * The five fixed disposition kinds of spec §7.2. Ordered as the node renders
 * them: the happy path first, escalations after, the infra failure last.
 */
export const AGENT_OUTCOME_KINDS = [
  'approved',
  'informative',
  'rejected',
  'guardrailBlocked',
  'error',
] as const

export type AgentOutcomeKind = (typeof AGENT_OUTCOME_KINDS)[number]

/**
 * Canvas source handle ids, one per outcome — `outcome:approved` and friends.
 * Namespaced so the handle set can grow without colliding with the default
 * handle, `ERROR_SOURCE_HANDLE_ID` or `SLA_BREACH_SOURCE_HANDLE_ID`.
 */
export const OUTCOME_SOURCE_HANDLE_PREFIX = 'outcome:'

/**
 * Run-context key carrying the disposition an agent step resolved to, so the
 * executor can route on it. ENGINE-OWNED and reserved against user context
 * writes, exactly like `WORKFLOW_ERROR_CONTEXT_KEY`: routing never reads the
 * author-visible `disposition` key, which is what makes this wiring rather than
 * string-matching.
 */
export const WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY = '__agentOutcome'

export interface WorkflowAgentOutcomeContextEntry {
  stepId: string
  outcome: AgentOutcomeKind
  occurredAt: string
  proposalId?: string
}

export function buildAgentOutcomeContextEntry(
  stepId: string,
  outcome: AgentOutcomeKind,
  proposalId?: string,
): WorkflowAgentOutcomeContextEntry {
  return {
    stepId,
    outcome,
    occurredAt: new Date().toISOString(),
    ...(proposalId ? { proposalId } : {}),
  }
}

export function isAgentOutcomeKind(value: unknown): value is AgentOutcomeKind {
  return typeof value === 'string' && (AGENT_OUTCOME_KINDS as readonly string[]).includes(value)
}

export function outcomeSourceHandleId(outcome: AgentOutcomeKind): string {
  return `${OUTCOME_SOURCE_HANDLE_PREFIX}${outcome}`
}

export function parseOutcomeSourceHandleId(handleId: unknown): AgentOutcomeKind | null {
  if (typeof handleId !== 'string' || !handleId.startsWith(OUTCOME_SOURCE_HANDLE_PREFIX)) return null
  const candidate = handleId.slice(OUTCOME_SOURCE_HANDLE_PREFIX.length)
  return isAgentOutcomeKind(candidate) ? candidate : null
}

export interface OutcomeRoutingTransitionLike {
  transitionId?: string
  fromStepId?: string
  toStepId?: string
  kind?: string
  outcomeKind?: string
  priority?: number
}

export interface OutcomeRoutingDefinitionLike extends ErrorRoutingDefinitionLike {
  transitions?: OutcomeRoutingTransitionLike[]
}

export type AgentOutcomeHandling =
  | { kind: 'route'; outcome: AgentOutcomeKind; transition: OutcomeRoutingTransitionLike }
  | { kind: 'inherit'; outcome: AgentOutcomeKind; handling: StepFailureHandling }
  | { kind: 'default' }

export function isOutcomeTransition(
  transition: OutcomeRoutingTransitionLike | null | undefined,
): boolean {
  return transition?.kind === OUTCOME_TRANSITION_KIND
}

/**
 * Outcome routes must never be taken by normal routing — they are reachable only
 * from a resolved disposition, exactly like error and SLA-breach routes. Every
 * routing lookup filters through this helper.
 */
export function excludeOutcomeTransitions<T extends OutcomeRoutingTransitionLike>(
  transitions: T[],
): T[] {
  return transitions.filter((transition) => !isOutcomeTransition(transition))
}

/** The outcome a route claims, or null when it claims none the platform knows. */
export function readTransitionOutcomeKind(
  transition: OutcomeRoutingTransitionLike | null | undefined,
): AgentOutcomeKind | null {
  if (!isOutcomeTransition(transition)) return null
  return isAgentOutcomeKind(transition?.outcomeKind) ? transition.outcomeKind : null
}

/** Every outcome a step has wired, in the platform's render order. */
export function listWiredOutcomes(
  definition: OutcomeRoutingDefinitionLike | null | undefined,
  stepId: string,
): AgentOutcomeKind[] {
  const wired = new Set<AgentOutcomeKind>()
  for (const transition of definition?.transitions ?? []) {
    if (transition.fromStepId !== stepId) continue
    const outcome = readTransitionOutcomeKind(transition)
    if (outcome) wired.add(outcome)
  }
  return AGENT_OUTCOME_KINDS.filter((outcome) => wired.has(outcome))
}

/**
 * Highest-priority outgoing route for one outcome. Ties keep definition order,
 * mirroring how `findValidTransitions` orders normal routes.
 */
export function findOutcomeTransition(
  definition: OutcomeRoutingDefinitionLike | null | undefined,
  stepId: string,
  outcome: AgentOutcomeKind,
): OutcomeRoutingTransitionLike | null {
  const candidates = (definition?.transitions ?? []).filter(
    (transition) =>
      transition.fromStepId === stepId && readTransitionOutcomeKind(transition) === outcome,
  )
  if (candidates.length === 0) return null
  const ordered = [...candidates].sort((left, right) => (right.priority || 0) - (left.priority || 0))
  return ordered[0] ?? null
}

/**
 * The single decision point for a resolved agent disposition. See the module
 * docblock for the precedence and why `default` covers both "nothing is wired"
 * cases — it is the whole of the backward-compatibility guarantee.
 */
export function resolveAgentOutcomeHandling(
  definition: OutcomeRoutingDefinitionLike | null | undefined,
  stepId: string,
  outcome: AgentOutcomeKind,
): AgentOutcomeHandling {
  if (listWiredOutcomes(definition, stepId).length === 0) return { kind: 'default' }

  const wired = findOutcomeTransition(definition, stepId, outcome)
  if (wired) return { kind: 'route', outcome, transition: wired }

  if (outcome === 'approved') return { kind: 'default' }

  return { kind: 'inherit', outcome, handling: resolveStepFailureHandling(definition, stepId) }
}

/**
 * Disposition vocabularies the platform speaks, mapped onto the §7.2 five.
 *
 * `auto_approved` is the agent-envelope spelling of `approved`; `edited` is a
 * human approving a proposal they amended, which still executes, so it routes
 * the approved handle rather than inventing a sixth outcome the spec does not
 * define. `pending` maps to nothing — the step is still parked.
 *
 * `none_proposed` — an agent that looked and had nothing to propose — takes the
 * `informative` handle, which is exactly what that route means. It is NOT
 * `rejected`: nothing was offered for a human to decline.
 */
const DISPOSITION_TO_OUTCOME: Record<string, AgentOutcomeKind> = {
  auto_approved: 'approved',
  approved: 'approved',
  edited: 'approved',
  informative: 'informative',
  none_proposed: 'informative',
  rejected: 'rejected',
  guardrail_blocked: 'guardrailBlocked',
  guardrailBlocked: 'guardrailBlocked',
}

export function mapDispositionToAgentOutcome(disposition: unknown): AgentOutcomeKind | null {
  if (typeof disposition !== 'string') return null
  return DISPOSITION_TO_OUTCOME[disposition] ?? null
}

/**
 * Structural recognition of a runtime guardrail `block` (spec §7.3).
 *
 * Shaped like `isRetryableError` in `activity-worker-handler`: core reads a tag
 * off the thrown value rather than importing `agent_orchestrator`, which stays
 * an OPTIONAL peer. `agent_guardrail_blocked` is the code
 * `AgentGuardrailBlockedError` carries; `guardrailBlocked: true` is the
 * forward-compatible tag any other runtime can set.
 */
export function isGuardrailBlockedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const tagged = error as { code?: unknown; guardrailBlocked?: unknown }
  return tagged.code === 'agent_guardrail_blocked' || tagged.guardrailBlocked === true
}

/**
 * The guardrail facts safe to bind to a workflow route.
 *
 * `agent_orchestrator/AGENTS.md` requires guardrail evidence to be REDACTED —
 * never raw PII — so only the classification travels: which phase tripped, which
 * check kind, and the guardrail-set version. The evidence blob itself stays on
 * the `AgentGuardrailCheck` row and is reached by id.
 */
export interface GuardrailBlockEvidenceRef {
  phase?: string
  kind?: string
  guardrailSetVersion?: string
  checkId?: string
}

export function readGuardrailBlockEvidenceRef(error: unknown): GuardrailBlockEvidenceRef {
  if (typeof error !== 'object' || error === null) return {}
  const tagged = error as Record<string, unknown>
  const pick = (key: string): string | undefined =>
    typeof tagged[key] === 'string' ? (tagged[key] as string) : undefined
  return {
    ...(pick('phase') ? { phase: pick('phase') } : {}),
    ...(pick('kind') ? { kind: pick('kind') } : {}),
    ...(pick('guardrailSetVersion') ? { guardrailSetVersion: pick('guardrailSetVersion') } : {}),
    ...(pick('checkId') ? { checkId: pick('checkId') } : {}),
  }
}

/**
 * Context key the guardrail evidence REFERENCE lands under when a block takes
 * the guardrail route, so the review task the author wires can bind it.
 */
export const WORKFLOW_GUARDRAIL_BLOCK_CONTEXT_KEY = '__guardrailBlock'

/** The engine-owned outcome marker for a step, or null when it names another step. */
export function readAgentOutcomeMarker(
  context: Record<string, unknown> | null | undefined,
  stepId: string,
): WorkflowAgentOutcomeContextEntry | null {
  const raw = context?.[WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Partial<WorkflowAgentOutcomeContextEntry>
  if (entry.stepId !== stepId) return null
  if (!isAgentOutcomeKind(entry.outcome)) return null
  return entry as WorkflowAgentOutcomeContextEntry
}

export interface OutcomeRouteIssue {
  code: 'OUTCOME_ROUTE_UNKNOWN_KIND' | 'OUTCOME_ROUTE_DUPLICATE_KIND'
  message: string
  transitionId?: string
  stepId?: string
}

/**
 * Author-time checks surfaced by the Problems panel. An outcome route claiming a
 * kind the platform does not define is unreachable, and two routes claiming the
 * same kind make the destination depend on priority ties rather than on wiring —
 * both are wiring mistakes the canvas cannot show.
 */
export function validateOutcomeRoutes(
  definition: OutcomeRoutingDefinitionLike | null | undefined,
): OutcomeRouteIssue[] {
  const issues: OutcomeRouteIssue[] = []
  const seen = new Map<string, number>()

  for (const transition of definition?.transitions ?? []) {
    if (!isOutcomeTransition(transition)) continue

    const outcome = readTransitionOutcomeKind(transition)
    if (!outcome) {
      issues.push({
        code: 'OUTCOME_ROUTE_UNKNOWN_KIND',
        message: `Outcome route ${transition.transitionId ?? ''} claims outcome "${transition.outcomeKind ?? ''}", which is not one of ${AGENT_OUTCOME_KINDS.join(', ')}`,
        transitionId: transition.transitionId,
        stepId: transition.fromStepId,
      })
      continue
    }

    const key = `${transition.fromStepId ?? ''}::${outcome}`
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    if (count > 1) {
      issues.push({
        code: 'OUTCOME_ROUTE_DUPLICATE_KIND',
        message: `Step ${transition.fromStepId ?? ''} has more than one route for the "${outcome}" outcome`,
        transitionId: transition.transitionId,
        stepId: transition.fromStepId,
      })
    }
  }

  return issues
}
