/**
 * Who may decide an approval step.
 *
 * The engine used to check only the route-level `approvals.action` grant, so any caller
 * holding it could approve any step. Authorization is a pure decision over the step's
 * configured approver, the actor, and the request-level reassignment, kept free of ORM
 * and IO so every approver type is unit-testable.
 *
 * A reassignment is stored per step on the request payload (`reassignments[stepOrder]`),
 * never on the shared workflow definition. The legacy scalar `reassignedToUserId` is
 * still read for requests written before the map existed.
 */

export type ApprovalActionName = 'approve' | 'reject' | 'reassign' | 'cancel'

export type ApprovalStepAuthorization = {
  approverType: 'role' | 'user' | 'manager'
  approverRoleId?: string | null
  approverUserId?: string | null
}

export type ApprovalActorContext = {
  actorUserId: string | null
  actorRoleIds: string[]
  targetEmployeeManagerUserId: string | null
  requestedByUserId: string | null
  reassignedToUserId: string | null
}

export type ApprovalAuthorizationFailure =
  | 'approval_not_authorized'
  | 'approval_approver_unresolved'

export type ApprovalAuthorizationResult =
  | { ok: true }
  | { ok: false; code: ApprovalAuthorizationFailure }

export function authorizeApprovalStep(input: {
  action: ApprovalActionName
  step: ApprovalStepAuthorization
  actor: ApprovalActorContext
}): ApprovalAuthorizationResult {
  const { action, step, actor } = input
  if (!actor.actorUserId) return { ok: false, code: 'approval_not_authorized' }

  if (action === 'cancel' && actor.requestedByUserId === actor.actorUserId) {
    return { ok: true }
  }

  if (actor.reassignedToUserId) {
    return actor.actorUserId === actor.reassignedToUserId
      ? { ok: true }
      : { ok: false, code: 'approval_not_authorized' }
  }

  if (step.approverType === 'user') {
    if (!step.approverUserId) return { ok: false, code: 'approval_approver_unresolved' }
    return step.approverUserId === actor.actorUserId
      ? { ok: true }
      : { ok: false, code: 'approval_not_authorized' }
  }

  if (step.approverType === 'role') {
    if (!step.approverRoleId) return { ok: false, code: 'approval_approver_unresolved' }
    return actor.actorRoleIds.includes(step.approverRoleId)
      ? { ok: true }
      : { ok: false, code: 'approval_not_authorized' }
  }

  if (!actor.targetEmployeeManagerUserId) {
    return { ok: false, code: 'approval_approver_unresolved' }
  }
  return actor.targetEmployeeManagerUserId === actor.actorUserId
    ? { ok: true }
    : { ok: false, code: 'approval_not_authorized' }
}

export function resolveReassignedApprover(
  payload: Record<string, unknown> | null | undefined,
  stepOrder: number,
): string | null {
  if (!payload) return null
  const reassignments = payload.reassignments
  if (reassignments && typeof reassignments === 'object' && !Array.isArray(reassignments)) {
    const value = (reassignments as Record<string, unknown>)[String(stepOrder)]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  const legacy = payload.reassignedToUserId
  return typeof legacy === 'string' && legacy.trim().length > 0 ? legacy.trim() : null
}
