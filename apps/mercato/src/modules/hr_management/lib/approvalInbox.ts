/**
 * Pure view helpers for the approvals inbox.
 *
 * Free of React, ORM and fetch so the mapping from a stored request to what an operator
 * sees can be unit-tested directly. This is the only place that turns the engine's
 * `entity_type` string back into a link, and the only place that decodes the marker the
 * engine appends to a reassignment comment, so both are pinned by tests rather than by
 * inspection: a value the engine writes but this module does not understand would render a
 * request nobody can open, or print a raw UUID into the audit trail.
 */

type ApprovalTargetSpec = {
  labelKey: string
  label: string
  href: (id: string) => string
}

/**
 * The entity types the engine decides today (`applyTargetEffect` in `commands/approvals.ts`),
 * each mapped to the screen that owns the record.
 */
const APPROVAL_TARGET_SPECS: Record<string, ApprovalTargetSpec> = {
  hr_leave_request: {
    labelKey: 'hr_management.approvals.targets.leave_request',
    label: 'Leave request',
    href: (id) => `/backend/hr/leave-requests/${id}/edit`,
  },
  hr_attendance_record: {
    labelKey: 'hr_management.approvals.targets.attendance_record',
    label: 'Attendance record',
    href: (id) => `/backend/hr/attendance/${id}/edit`,
  },
  hr_payroll_run: {
    labelKey: 'hr_management.approvals.targets.payroll_run',
    label: 'Payroll run',
    href: (id) => `/backend/hr/payroll/${id}`,
  },
}

export type ApprovalTarget = {
  entityType: string
  labelKey: string
  label: string
  href: string
}

/**
 * Resolves the record an approval request is about.
 *
 * `null` for an entity type this build does not know: a request written by a newer build or
 * by a module that reuses the engine must still appear in the queue without a link, rather
 * than throwing or pointing at the wrong screen.
 */
export function resolveApprovalTarget(
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): ApprovalTarget | null {
  if (!entityType || !entityId) return null
  const spec = APPROVAL_TARGET_SPECS[entityType]
  if (!spec) return null
  return { entityType, labelKey: spec.labelKey, label: spec.label, href: spec.href(entityId) }
}

/** Step row as the `/hr/approval-steps` list returns it (snake_case, straight from the API). */
export type ApprovalStepRow = {
  id: string
  workflow_id: string
  step_order: number
  name: string
  approver_type: 'role' | 'user' | 'manager'
  approver_role_id?: string | null
  approver_user_id?: string | null
  required_approvals?: number | null
  is_final?: boolean | null
}

export type ApprovalStepProgress = {
  /** 1-based position of the current step among the ordered steps; 0 when there are none. */
  index: number
  total: number
  /** Whether this step is the last one, so the next quorum completes the request. */
  isFinalStep: boolean
}

export function findCurrentStep(
  steps: ApprovalStepRow[],
  currentStepOrder: number,
): ApprovalStepRow | null {
  const ordered = [...steps].sort((left, right) => left.step_order - right.step_order)
  return ordered.find((step) => step.step_order === currentStepOrder) ?? ordered[0] ?? null
}

export function describeStepProgress(
  steps: ApprovalStepRow[],
  currentStepOrder: number,
): ApprovalStepProgress {
  const ordered = [...steps].sort((left, right) => left.step_order - right.step_order)
  const matched = ordered.findIndex((step) => step.step_order === currentStepOrder)
  // A stored order that matches no step (the workflow was edited after submission) resolves to
  // the first step — the same fallback as `findCurrentStep` — so the reported position and the
  // reported step never disagree.
  const position = matched >= 0 ? matched : (ordered.length > 0 ? 0 : -1)
  const current = position >= 0 ? ordered[position] : null
  return {
    index: current ? position + 1 : 0,
    total: ordered.length,
    isFinalStep: current?.is_final === true,
  }
}

/**
 * Whether the current step names this actor, so the inbox can lift "needs you" to the top.
 *
 * Only `user` steps are decided here. A `role` or `manager` step is resolved by the engine
 * against role membership and the reporting line at decision time, and the inbox
 * deliberately does not guess: hiding a request an operator can actually decide is a worse
 * failure than showing one they cannot.
 */
export function isAwaitingActor(
  step: ApprovalStepRow | null | undefined,
  actorUserId: string,
): boolean {
  if (!step || !actorUserId) return false
  return step.approver_type === 'user' && step.approver_user_id === actorUserId
}

export type ApprovalCommentParts = {
  /** The operator's own words, without the engine's machine-readable marker. */
  text: string
  /** The user a reassignment handed the step to, when the log row carries one. */
  reassignedToUserId: string | null
}

const REASSIGN_MARKER = 'reassigned_to:'

/**
 * Splits a log comment into the operator's text and the reassignment target the engine
 * appends (`appendComment(comment, 'reassigned_to:<uuid>')`). The marker is always its own
 * trailing line, so the operator's text is everything before it, newlines included.
 */
export function parseApprovalComment(comment: string | null | undefined): ApprovalCommentParts {
  const raw = comment ?? ''
  const lines = raw.split('\n')
  const markerIndex = lines.findLastIndex((line) => line.trim().startsWith(REASSIGN_MARKER))
  if (markerIndex < 0) return { text: raw.trim(), reassignedToUserId: null }
  const target = lines[markerIndex].trim().slice(REASSIGN_MARKER.length).trim()
  return {
    text: lines.slice(0, markerIndex).join('\n').trim(),
    reassignedToUserId: target.length > 0 ? target : null,
  }
}

/** Days a request has been waiting, or `null` when it is not pending or has no timestamp. */
export function pendingAgeInDays(
  createdAt: string | null | undefined,
  status: string,
  now: Date = new Date(),
): number | null {
  if (status !== 'pending' || !createdAt) return null
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) return null
  const days = Math.floor((now.getTime() - created.getTime()) / 86_400_000)
  return days < 0 ? 0 : days
}
