/**
 * Workflows Module — the Invoke Agent node's Review section (spec §7.5).
 *
 * "Who reviews a proposal this step raises, and by when." The thing being
 * authored is a real task — the implicit disposition task the enterprise
 * `dispositionService` raises when the confidence gate routes to a human — so
 * every rule here delegates to the §6.1 task resolvers rather than restating
 * them. What is NEW is the breach vocabulary, and what is new about it is what
 * it LACKS.
 *
 * ## A breached disposition deadline escalates. It never decides.
 *
 * `resolveAgentReviewBreachHandling` has no `route` arm and no verdict arm, and
 * that absence is the feature. Auto-rejecting a proposal nobody answered — or
 * auto-approving it, or routing the run past it — is a disposition reached
 * without a human, which is precisely the boundary
 * `agent_orchestrator/AGENTS.md` guards ("Ask before changing … the auto-approve
 * vs `user_task` boundary"). The maintainer decision for this phase is explicit:
 * on breach, notify / reassign / mark for attention; the proposal stays
 * `pending` until a person acts. The accepted cost is that a breached proposal
 * can sit indefinitely if nobody picks it up — which is a queue that is visibly
 * behind, not a decision made by a timer.
 *
 * PURE: no ORM, DI, React or registry imports. Callers pass plain definition
 * JSON and an `interpolate` bound to the run context.
 */

import type { AgentReviewConfig, AgentReviewOnBreach } from '../data/activity-config-schemas'
import type { AgentDispositionReview } from './agent-disposition-task'
import { resolveBreachReassignTarget } from './breach-routing'
import {
  resolveTaskAssignment,
  type ResolvedTaskAssignment,
  type TaskInterpolate,
} from './task-resolution'

export const INVOKE_AGENT_ACTIVITY_TYPE = 'INVOKE_AGENT'

export interface AgentReviewStepLike {
  activities?: { activityType?: string; config?: { review?: unknown } }[] | null
}

export interface AgentReviewDefinitionLike {
  steps?: ({ stepId?: string } & AgentReviewStepLike)[] | null
}

export interface ResolvedAgentReview extends ResolvedTaskAssignment {
  priority: string | null
  /** Authored deadline duration; the absolute due date is anchored to task creation. */
  deadlineDuration: string | null
  reminders: { offset: string }[] | null
}

export type AgentReviewBreachHandling =
  | { kind: 'notify' }
  | { kind: 'reassign'; assignedTo: string | null; assignedToRoles: string[] | null }
  | { kind: 'attention' }
  | { kind: 'none' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The Review config authored on a step's INVOKE_AGENT activity.
 *
 * Read structurally rather than through the zod schema so a definition the
 * engine can still execute is never rejected here: a malformed Review block
 * degrades to "no review configured", which is the behaviour every definition
 * authored before this section existed already has.
 */
export function findAgentReviewConfig(
  step: AgentReviewStepLike | null | undefined,
): AgentReviewConfig | null {
  const activity = (step?.activities ?? []).find(
    (candidate) => candidate?.activityType === INVOKE_AGENT_ACTIVITY_TYPE,
  )
  const review = activity?.config?.review
  return isRecord(review) ? (review as AgentReviewConfig) : null
}

/** The Review config of one step of a definition, addressed by step id. */
export function findAgentReviewConfigForStep(
  definition: AgentReviewDefinitionLike | null | undefined,
  stepId: string,
): AgentReviewConfig | null {
  const step = (definition?.steps ?? []).find((candidate) => candidate?.stepId === stepId)
  return findAgentReviewConfig(step)
}

/**
 * Resolve the authored Review section against the run context.
 *
 * Assignment goes through the SAME `resolveTaskAssignment` a USER_TASK step
 * uses, so a dynamic assignee that resolves to nothing falls back to the
 * authored role queue here exactly as it does there — never to an unassigned
 * row, which under the §6.4 visibility model is a row nobody can act on.
 *
 * `assigneeKind` is always `'user'`: a proposal is disposed from the backoffice
 * caseload, and a portal principal has no surface that could dispose one.
 */
export function resolveAgentReview(
  review: AgentReviewConfig | null | undefined,
  interpolate: TaskInterpolate,
): ResolvedAgentReview {
  const assignment = resolveTaskAssignment(
    {
      assignedTo: review?.assignedTo,
      assignedToRoles: review?.assignedToRoles,
    },
    interpolate,
  )

  const reminders = (review?.reminders ?? []).filter(
    (reminder) => typeof reminder?.offset === 'string' && reminder.offset.length > 0,
  )

  return {
    ...assignment,
    priority: review?.priority ?? null,
    deadlineDuration:
      typeof review?.deadline?.duration === 'string' && review.deadline.duration.length
        ? review.deadline.duration
        : null,
    reminders: reminders.length ? reminders : null,
  }
}

/**
 * Project a resolved Review onto the descriptor that crosses the bridge to
 * `agent_orchestrator`.
 *
 * Returns null when the author configured nothing, so a step that never opened
 * the Review section sends no descriptor at all and the disposition service
 * takes exactly the path it took before.
 */
export function toAgentDispositionReview(
  resolved: ResolvedAgentReview,
): AgentDispositionReview | null {
  const descriptor: AgentDispositionReview = {
    ...(resolved.assignedTo ? { assignedTo: resolved.assignedTo } : {}),
    ...(resolved.assignedToRoles?.length ? { assignedToRoles: resolved.assignedToRoles } : {}),
    ...(resolved.priority ? { priority: resolved.priority } : {}),
    ...(resolved.deadlineDuration ? { deadlineDuration: resolved.deadlineDuration } : {}),
    ...(resolved.reminders?.length ? { reminders: resolved.reminders } : {}),
  }
  return Object.keys(descriptor).length ? descriptor : null
}

/**
 * The single decision point for a breached disposition deadline.
 *
 * Every fall-through is `none`, which is what a step that authored no breach
 * action has always done. Note what cannot be returned: nothing here disposes
 * the proposal, and nothing here advances the run past it.
 */
export function resolveAgentReviewBreachHandling(
  onBreach: AgentReviewOnBreach | null | undefined,
): AgentReviewBreachHandling {
  const action = onBreach?.action

  if (action === 'notify') return { kind: 'notify' }
  if (action === 'attention') return { kind: 'attention' }

  if (action === 'reassign') {
    const target = resolveBreachReassignTarget(onBreach?.reassignTo)
    return target ? { kind: 'reassign', ...target } : { kind: 'none' }
  }

  return { kind: 'none' }
}
