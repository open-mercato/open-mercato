/** @jest-environment node */
/**
 * Pins who may decide an approval step.
 *
 * The engine previously checked only the route-level `approvals.action` grant, so every
 * case below would have been allowed and the failure would have been invisible until a
 * real request was approved by the wrong person. The reassignment map is asserted too
 * because it is persisted on the request payload and read back at decision time.
 */
import {
  authorizeApprovalStep,
  resolveReassignedApprover,
  type ApprovalActorContext,
  type ApprovalStepAuthorization,
} from '../approvalAuthorization'

const actor = (overrides: Partial<ApprovalActorContext> = {}): ApprovalActorContext => ({
  actorUserId: 'user-actor',
  actorRoleIds: [],
  targetEmployeeManagerUserId: null,
  requestedByUserId: 'user-requester',
  reassignedToUserId: null,
  ...overrides,
})

const step = (overrides: Partial<ApprovalStepAuthorization> = {}): ApprovalStepAuthorization => ({
  approverType: 'user',
  approverUserId: 'user-actor',
  approverRoleId: null,
  ...overrides,
})

describe('approval authorization', () => {
  it('allows the configured user and refuses anyone else', () => {
    expect(authorizeApprovalStep({ action: 'approve', step: step(), actor: actor() })).toEqual({ ok: true })
    expect(authorizeApprovalStep({
      action: 'approve',
      step: step(),
      actor: actor({ actorUserId: 'user-other' }),
    })).toEqual({ ok: false, code: 'approval_not_authorized' })
  })

  it('allows a role member and refuses a user without the role', () => {
    const roleStep = step({ approverType: 'role', approverUserId: null, approverRoleId: 'role-hr' })
    expect(authorizeApprovalStep({
      action: 'approve',
      step: roleStep,
      actor: actor({ actorRoleIds: ['role-hr'] }),
    })).toEqual({ ok: true })
    expect(authorizeApprovalStep({
      action: 'approve',
      step: roleStep,
      actor: actor({ actorRoleIds: ['role-other'] }),
    })).toEqual({ ok: false, code: 'approval_not_authorized' })
  })

  it('reports an unresolved approver rather than authorizing a malformed step', () => {
    expect(authorizeApprovalStep({
      action: 'approve',
      step: step({ approverType: 'user', approverUserId: null }),
      actor: actor(),
    })).toEqual({ ok: false, code: 'approval_approver_unresolved' })
    expect(authorizeApprovalStep({
      action: 'approve',
      step: step({ approverType: 'role', approverUserId: null, approverRoleId: null }),
      actor: actor(),
    })).toEqual({ ok: false, code: 'approval_approver_unresolved' })
  })

  it('allows only the resolved manager on a manager step', () => {
    const managerStep = step({ approverType: 'manager', approverUserId: null })
    expect(authorizeApprovalStep({
      action: 'approve',
      step: managerStep,
      actor: actor({ actorUserId: 'user-manager', targetEmployeeManagerUserId: 'user-manager' }),
    })).toEqual({ ok: true })
    expect(authorizeApprovalStep({
      action: 'approve',
      step: managerStep,
      actor: actor({ actorUserId: 'user-other', targetEmployeeManagerUserId: 'user-manager' }),
    })).toEqual({ ok: false, code: 'approval_not_authorized' })
    expect(authorizeApprovalStep({
      action: 'approve',
      step: managerStep,
      actor: actor({ targetEmployeeManagerUserId: null }),
    })).toEqual({ ok: false, code: 'approval_approver_unresolved' })
  })

  it('lets a reassignment override the configured approver for that step', () => {
    expect(authorizeApprovalStep({
      action: 'approve',
      step: step({ approverType: 'role', approverUserId: null, approverRoleId: 'role-hr' }),
      actor: actor({ actorUserId: 'user-delegate', reassignedToUserId: 'user-delegate' }),
    })).toEqual({ ok: true })
    expect(authorizeApprovalStep({
      action: 'approve',
      step: step(),
      actor: actor({ actorUserId: 'user-other', reassignedToUserId: 'user-delegate' }),
    })).toEqual({ ok: false, code: 'approval_not_authorized' })
  })

  it('lets the requester cancel their own request', () => {
    expect(authorizeApprovalStep({
      action: 'cancel',
      step: step(),
      actor: actor({ actorUserId: 'user-requester', requestedByUserId: 'user-requester' }),
    })).toEqual({ ok: true })
    expect(authorizeApprovalStep({
      action: 'cancel',
      step: step(),
      actor: actor({ actorUserId: 'user-other' }),
    })).toEqual({ ok: false, code: 'approval_not_authorized' })
  })

  it('refuses every action without an authenticated actor', () => {
    expect(authorizeApprovalStep({
      action: 'approve',
      step: step(),
      actor: actor({ actorUserId: null }),
    })).toEqual({ ok: false, code: 'approval_not_authorized' })
  })
})

describe('reassignment override lookup', () => {
  it('reads the override for the current step from the map', () => {
    const payload = { reassignments: { '1': 'user-one', '2': 'user-two' } }
    expect(resolveReassignedApprover(payload, 1)).toBe('user-one')
    expect(resolveReassignedApprover(payload, 2)).toBe('user-two')
    expect(resolveReassignedApprover(payload, 3)).toBeNull()
  })

  it('falls back to the legacy scalar for requests written before the map', () => {
    expect(resolveReassignedApprover({ reassignedToUserId: 'user-legacy' }, 1)).toBe('user-legacy')
  })

  it('returns null for an empty or malformed payload', () => {
    expect(resolveReassignedApprover(null, 1)).toBeNull()
    expect(resolveReassignedApprover({}, 1)).toBeNull()
    expect(resolveReassignedApprover({ reassignments: { '1': '' } }, 1)).toBeNull()
  })
})
