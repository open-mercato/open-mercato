/**
 * Editor-side drafts for the Invoke Agent node's Review section (spec §7.5).
 *
 * The sibling of `lib/task-inspector-config.ts`, and deliberately shaped like
 * it: the Review section authors the same Who/When vocabulary a task does, so
 * the drafts are the same drafts and the inspector reuses the same field
 * components. What differs is the breach action set — a disposition deadline
 * escalates and never decides, so `route` is absent and `attention` is present.
 *
 * PURE: no React, ORM, DI or registry imports.
 */

import type { AgentReviewConfig, AgentReviewOnBreach } from '../data/activity-config-schemas'
import type { TaskAssignmentMode } from './task-inspector-config'

export const AGENT_REVIEW_ON_BREACH_ACTIONS: readonly AgentReviewOnBreach['action'][] = [
  'notify',
  'reassign',
  'attention',
] as const

/**
 * A proposal is disposed from the backoffice caseload, so the Rule tab has no
 * engine behind it here — `resolveAgentReview` reads exactly the three tabs
 * below. Offering a fourth would be authoring config nothing honours.
 */
export const AGENT_REVIEW_ASSIGNMENT_MODES: readonly TaskAssignmentMode[] = [
  'role',
  'user',
  'dynamic',
] as const

export interface AgentReviewOnBreachDraft {
  action: '' | AgentReviewOnBreach['action']
  reassignTo: string
}

export interface AgentReviewFormValues {
  reviewAssignmentMode: TaskAssignmentMode
  reviewAssignedTo: string
  reviewAssignedToRoles: string[]
  reviewAssignmentRule: string
  reviewPriority: string
  reviewDeadline: string
  reviewReminders: string[]
  reviewOnBreach: AgentReviewOnBreachDraft
}

function isAgentReviewPriority(value: unknown): value is NonNullable<AgentReviewConfig['priority']> {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'extreme'
}

/**
 * Which tab a stored Review belongs to. Derived exactly as the task inspector
 * derives its own: an individual assignee that carries a `{{…}}` pill is a
 * Dynamic assignment, a literal one is a User assignment, and everything else
 * is the role queue.
 */
export function deriveAgentReviewAssignmentMode(assignedTo: string): TaskAssignmentMode {
  if (!assignedTo.length) return 'role'
  return assignedTo.includes('{{') ? 'dynamic' : 'user'
}

export function agentReviewToFormValues(
  review: AgentReviewConfig | null | undefined,
): AgentReviewFormValues {
  const assignedTo = typeof review?.assignedTo === 'string' ? review.assignedTo : ''
  return {
    reviewAssignmentMode: deriveAgentReviewAssignmentMode(assignedTo),
    reviewAssignedTo: assignedTo,
    reviewAssignedToRoles: Array.isArray(review?.assignedToRoles) ? [...review.assignedToRoles] : [],
    reviewAssignmentRule: '',
    reviewPriority: isAgentReviewPriority(review?.priority) ? review.priority : '',
    reviewDeadline: typeof review?.deadline?.duration === 'string' ? review.deadline.duration : '',
    reviewReminders: (review?.reminders ?? [])
      .map((reminder) => (typeof reminder?.offset === 'string' ? reminder.offset : ''))
      .filter((offset) => offset.length > 0),
    reviewOnBreach: {
      action: review?.onBreach?.action ?? '',
      reassignTo: review?.onBreach?.reassignTo ?? '',
    },
  }
}

/**
 * Persist only what the author actually configured.
 *
 * Returns `undefined` for an untouched section so a step that never opened it
 * serializes byte-identically to one authored before the section existed —
 * the same "absent stays absent" rule the task inspector holds to.
 */
export function formValuesToAgentReview(
  values: Partial<AgentReviewFormValues> | undefined,
): AgentReviewConfig | undefined {
  const mode = values?.reviewAssignmentMode
  const assignedTo = mode === 'role' ? '' : (values?.reviewAssignedTo ?? '').trim()
  const assignedToRoles = (values?.reviewAssignedToRoles ?? [])
    .map((role) => (typeof role === 'string' ? role.trim() : ''))
    .filter((role) => role.length > 0)
  const deadline = (values?.reviewDeadline ?? '').trim()
  const reminders = (values?.reviewReminders ?? [])
    .map((offset) => (typeof offset === 'string' ? offset.trim() : ''))
    .filter((offset) => offset.length > 0)
    .map((offset) => ({ offset }))
  const breachAction = values?.reviewOnBreach?.action
  const reassignTo = (values?.reviewOnBreach?.reassignTo ?? '').trim()

  const review: AgentReviewConfig = {
    ...(assignedTo ? { assignedTo } : {}),
    ...(assignedToRoles.length ? { assignedToRoles } : {}),
    ...(isAgentReviewPriority(values?.reviewPriority) ? { priority: values.reviewPriority } : {}),
    ...(deadline ? { deadline: { duration: deadline } } : {}),
    ...(reminders.length ? { reminders } : {}),
    ...(breachAction
      ? {
          onBreach:
            breachAction === 'reassign' && reassignTo
              ? { action: breachAction, reassignTo }
              : { action: breachAction },
        }
      : {}),
  }

  return Object.keys(review).length ? review : undefined
}
