/**
 * Decision buttons on a task: the CHOICE and the routing rules (PURE).
 *
 * Rendering the list and recording the press are two different requirements
 * wearing one name, and they are stored differently on purpose (run checkpoint
 * 2, decision #2):
 *
 * - **The list is derived state.** A task reaches its config through
 *   `workflowInstanceId -> definition -> step.userTaskConfig.decisions`, and an
 *   instance PINS its definition row, so re-resolving it per request is always
 *   correct and needs no column. `lib/task-decision-context.ts` does that
 *   resolution (it needs the ORM); everything here stays free of it so the task
 *   surfaces can import the reserved key and the readers without dragging the
 *   entity graph into a client bundle.
 * - **The choice is an audit fact about the completion**, with a different
 *   lifetime from the list. It is written into the completion payload that
 *   already exists (`user_tasks.form_data`, under `TASK_DECISION_FORM_KEY`) and
 *   into the `USER_TASK_COMPLETED` event, rather than into a new column.
 */

import type { TaskDecision } from '../data/validators'
import { excludeNonNormalTransitions } from './route-kinds'
import type { ResolvedTaskDecision } from './task-resolution'

/**
 * Reserved key the chosen decision id is recorded under inside the completion
 * `formData`. Prefixed like the engine's other reserved context key
 * (`context.__error`) so it cannot collide with an authored form field, and so
 * a downstream route condition can branch on the operator's choice once the
 * form data is merged into the run context.
 */
export const TASK_DECISION_FORM_KEY = '__decision'

export type TaskDecisionTransitionLike = {
  transitionId?: string
  fromStepId?: string
  toStepId?: string
  kind?: string
}

export function findTaskDecision(
  decisions: ResolvedTaskDecision[],
  decisionId: string,
): ResolvedTaskDecision | null {
  return decisions.find((decision) => decision.id === decisionId) ?? null
}

/**
 * The outgoing route a decision selects.
 *
 * Matched on the transition's DURABLE id and constrained to routes leaving the
 * step the task is parked on — a decision may never send the run down a route
 * that does not start where the run currently is. Error routes are excluded for
 * the same reason every other routing lookup excludes them: they are reachable
 * only from a failure, never from a button.
 */
export function findTaskDecisionTransition<T extends TaskDecisionTransitionLike>(
  transitions: T[] | undefined | null,
  transitionId: string,
  fromStepId: string,
): T | null {
  if (!transitions?.length) return null
  const candidates = excludeNonNormalTransitions(transitions)
  return (
    candidates.find(
      (transition) =>
        transition.transitionId === transitionId && transition.fromStepId === fromStepId,
    ) ?? null
  )
}

/** Record the chosen decision inside the completion payload that already exists. */
export function withRecordedDecision(
  formData: Record<string, unknown>,
  decisionId: string | null | undefined,
): Record<string, unknown> {
  if (!decisionId) return formData
  return { ...formData, [TASK_DECISION_FORM_KEY]: decisionId }
}

/** The decision id a completed task recorded, when it recorded one. */
export function readRecordedDecision(formData: unknown): string | null {
  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) return null
  const value = (formData as Record<string, unknown>)[TASK_DECISION_FORM_KEY]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Decisions as authored, narrowed structurally.
 *
 * A definition row is validated on save, but code-registry definitions never
 * pass through zod, so an entry missing its id or its route binding is dropped
 * here rather than rendered as a button that can only fail.
 */
export function readAuthoredTaskDecisions(definitionData: unknown, stepId: string): TaskDecision[] {
  if (!definitionData || typeof definitionData !== 'object') return []
  const steps = (definitionData as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return []
  const step = steps.find(
    (candidate) =>
      !!candidate &&
      typeof candidate === 'object' &&
      (candidate as { stepId?: unknown }).stepId === stepId,
  ) as { userTaskConfig?: { decisions?: unknown } } | undefined
  const authored = step?.userTaskConfig?.decisions
  if (!Array.isArray(authored)) return []

  const decisions: TaskDecision[] = []
  for (const entry of authored) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.id !== 'string' || !candidate.id.length) continue
    if (typeof candidate.transitionId !== 'string' || !candidate.transitionId.length) continue
    decisions.push(candidate as unknown as TaskDecision)
  }
  return decisions
}
