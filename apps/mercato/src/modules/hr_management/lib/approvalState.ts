/**
 * Pure decisions for the HR approval workflow.
 *
 * Kept free of ORM, DI and IO so the state machine can be unit-tested directly, and so
 * the command layer only has to own persistence, locking and side effects. Every value
 * written here (`status`, `action`) is part of the persisted contract and mirrors the
 * enums in `data/entities.ts`: an invented value would be rejected by the validators.
 */

export type ApprovalAction = 'submit' | 'approve' | 'reject' | 'reassign' | 'cancel'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type ApprovalLogAction = 'approved' | 'rejected' | 'commented' | 'reassigned' | 'cancelled'

export type ApprovalStep = {
  stepOrder: number
  approverType: 'role' | 'user' | 'manager'
  requiredApprovals: number
  isFinal: boolean
}

export type ApprovalDecisionInput = {
  action: ApprovalAction
  status: ApprovalStatus
  currentStepOrder: number
  steps: ApprovalStep[]
  /** Log rows already recorded at the current step, used for the requiredApprovals quorum. */
  approvalsAtCurrentStep: number
  /** Required for `reassign`: the user the current step is being handed to. */
  reassignToUserId?: string | null
}

export type ApprovalErrorCode =
  | 'already_decided'
  | 'no_steps'
  | 'step_not_found'
  | 'reassign_target_required'
  | 'not_submittable'

export type ApprovalDecision =
  | {
      kind: 'ok'
      status: ApprovalStatus
      currentStepOrder: number
      decided: boolean
      /** Absent on `submit`: APPROVAL_ACTIONS has no "submitted" member, so creating the
       *  request is its own record and the engine does not invent a log value for it. */
      logAction?: ApprovalLogAction
    }
  | { kind: 'error'; code: ApprovalErrorCode }

export function isDecided(status: ApprovalStatus): boolean {
  return status === 'approved' || status === 'rejected' || status === 'cancelled'
}

export function firstStep(steps: ApprovalStep[]): ApprovalStep | null {
  if (steps.length === 0) return null
  return [...steps].sort((left, right) => left.stepOrder - right.stepOrder)[0] ?? null
}

export function nextStep(steps: ApprovalStep[], currentStepOrder: number): ApprovalStep | null {
  const ordered = [...steps].sort((left, right) => left.stepOrder - right.stepOrder)
  return ordered.find((step) => step.stepOrder > currentStepOrder) ?? null
}

/** Counts the log rows that count towards the quorum at one step. */
export function countApprovals(logs: Array<{ stepOrder: number | null; action: string }>, stepOrder: number): number {
  return logs.filter((log) => log.stepOrder === stepOrder && log.action === 'approved').length
}

export function decideApproval(input: ApprovalDecisionInput): ApprovalDecision {
  const { action, status, currentStepOrder, steps, approvalsAtCurrentStep } = input

  if (action === 'submit') {
    if (status !== 'pending') return { kind: 'error', code: 'not_submittable' }
    const step = firstStep(steps)
    if (!step) return { kind: 'error', code: 'no_steps' }
    return { kind: 'ok', status: 'pending', currentStepOrder: step.stepOrder, decided: false }
  }

  // Every other action is refused once the request has reached a terminal state.
  if (isDecided(status)) return { kind: 'error', code: 'already_decided' }

  const current = steps.find((step) => step.stepOrder === currentStepOrder)
  if (!current) return { kind: 'error', code: 'step_not_found' }

  if (action === 'reject') {
    return { kind: 'ok', status: 'rejected', currentStepOrder, decided: true, logAction: 'rejected' }
  }

  if (action === 'cancel') {
    return { kind: 'ok', status: 'cancelled', currentStepOrder, decided: true, logAction: 'cancelled' }
  }

  if (action === 'reassign') {
    if (!input.reassignToUserId) return { kind: 'error', code: 'reassign_target_required' }
    // The workflow definition is shared by every request, so a reassignment is recorded on
    // this request (log comment plus payload) instead of mutating the step.
    return { kind: 'ok', status: 'pending', currentStepOrder, decided: false, logAction: 'reassigned' }
  }

  const approvalsAfterAction = approvalsAtCurrentStep + 1
  if (approvalsAfterAction < Math.max(1, current.requiredApprovals)) {
    return { kind: 'ok', status: 'pending', currentStepOrder, decided: false, logAction: 'approved' }
  }

  if (current.isFinal) {
    return { kind: 'ok', status: 'approved', currentStepOrder, decided: true, logAction: 'approved' }
  }

  const following = nextStep(steps, currentStepOrder)
  if (!following) {
    // A quorum met on a step that is not marked final and has no successor still completes
    // the request: refusing here would deadlock a request nobody can advance.
    return { kind: 'ok', status: 'approved', currentStepOrder, decided: true, logAction: 'approved' }
  }

  return { kind: 'ok', status: 'pending', currentStepOrder: following.stepOrder, decided: false, logAction: 'approved' }
}
