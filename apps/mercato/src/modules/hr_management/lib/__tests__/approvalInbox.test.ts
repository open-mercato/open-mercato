/** @jest-environment node */
/**
 * Pins the two decodings the approvals inbox depends on and cannot verify by looking at it.
 *
 * The engine stores `entity_type` as a plain string and appends a machine-readable marker to a
 * reassignment comment. Both are written by the command layer and read here, so a rename on
 * either side would quietly produce a queue row with no link, or an audit line printing a raw
 * UUID. Neither failure throws, and neither is visible to the type checker.
 */
import {
  describeStepProgress,
  findCurrentStep,
  isAwaitingActor,
  parseApprovalComment,
  pendingAgeInDays,
  resolveApprovalTarget,
  type ApprovalStepRow,
} from '../approvalInbox'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222'
const ROLE_ID = '33333333-3333-4333-8333-333333333333'

function step(overrides: Partial<ApprovalStepRow> = {}): ApprovalStepRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    workflow_id: '55555555-5555-4555-8555-555555555555',
    step_order: 1,
    name: 'Manager',
    approver_type: 'user',
    approver_user_id: USER_ID,
    approver_role_id: null,
    required_approvals: 1,
    is_final: true,
    ...overrides,
  }
}

describe('resolveApprovalTarget', () => {
  it('links a leave request to the screen that owns it', () => {
    const target = resolveApprovalTarget('hr_leave_request', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(target?.href).toBe('/backend/hr/leave-requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/edit')
    expect(target?.labelKey).toBe('hr_management.approvals.targets.leave_request')
  })

  it('links an attendance record to the attendance screen', () => {
    const target = resolveApprovalTarget('hr_attendance_record', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(target?.href).toBe('/backend/hr/attendance/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/edit')
  })

  it('keeps an unknown entity type in the queue without a link', () => {
    expect(resolveApprovalTarget('sales_order', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toBeNull()
  })

  it('refuses to build a link without both halves', () => {
    expect(resolveApprovalTarget('hr_leave_request', null)).toBeNull()
    expect(resolveApprovalTarget(null, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toBeNull()
    expect(resolveApprovalTarget('', '')).toBeNull()
  })
})

describe('describeStepProgress', () => {
  const steps = [
    step({ step_order: 1, is_final: false, name: 'Team lead' }),
    step({ step_order: 2, is_final: false, name: 'HR' }),
    step({ step_order: 3, is_final: true, name: 'Finance' }),
  ]

  it('reports the position among the ordered steps, not the raw step order', () => {
    expect(describeStepProgress(steps, 2)).toEqual({ index: 2, total: 3, isFinalStep: false })
  })

  it('flags the last step so the operator knows this approval completes the request', () => {
    expect(describeStepProgress(steps, 3)).toEqual({ index: 3, total: 3, isFinalStep: true })
  })

  it('falls back to the first step when the stored order matches no step', () => {
    expect(describeStepProgress(steps, 9)).toEqual({ index: 1, total: 3, isFinalStep: false })
  })

  it('reports nothing for a workflow without steps', () => {
    expect(describeStepProgress([], 1)).toEqual({ index: 0, total: 0, isFinalStep: false })
  })

  it('finds the current step and falls back to the first one', () => {
    expect(findCurrentStep(steps, 2)?.name).toBe('HR')
    expect(findCurrentStep(steps, 42)?.name).toBe('Team lead')
    expect(findCurrentStep([], 1)).toBeNull()
  })
})

describe('isAwaitingActor', () => {
  it('recognises the user a step names', () => {
    expect(isAwaitingActor(step(), USER_ID)).toBe(true)
  })

  it('does not claim a role or manager step as this actor', () => {
    const roleStep = step({ approver_type: 'role', approver_user_id: null, approver_role_id: ROLE_ID })
    expect(isAwaitingActor(roleStep, USER_ID)).toBe(false)
    expect(isAwaitingActor(step({ approver_type: 'manager', approver_user_id: null }), USER_ID)).toBe(false)
  })

  it('is false for another user, a missing step and an unresolved actor', () => {
    expect(isAwaitingActor(step({ approver_user_id: OTHER_USER_ID }), USER_ID)).toBe(false)
    expect(isAwaitingActor(null, USER_ID)).toBe(false)
    expect(isAwaitingActor(step(), '')).toBe(false)
  })
})

describe('parseApprovalComment', () => {
  it('keeps the operator text and lifts the reassignment target out of it', () => {
    const parts = parseApprovalComment('On leave, cover arranged\nreassigned_to:' + OTHER_USER_ID)
    expect(parts.text).toBe('On leave, cover arranged')
    expect(parts.reassignedToUserId).toBe(OTHER_USER_ID)
  })

  it('leaves a plain comment untouched', () => {
    expect(parseApprovalComment('Approved by phone')).toEqual({ text: 'Approved by phone', reassignedToUserId: null })
  })

  it('does not treat a marker word inside the text as a reassignment', () => {
    const parts = parseApprovalComment('see reassigned_to: notes in the file')
    expect(parts.reassignedToUserId).toBeNull()
    expect(parts.text).toBe('see reassigned_to: notes in the file')
  })

  it('handles an empty or missing comment', () => {
    expect(parseApprovalComment(null)).toEqual({ text: '', reassignedToUserId: null })
    expect(parseApprovalComment('')).toEqual({ text: '', reassignedToUserId: null })
    expect(parseApprovalComment('  ')).toEqual({ text: '', reassignedToUserId: null })
  })
})

describe('pendingAgeInDays', () => {
  const now = new Date('2026-09-26T12:00:00.000Z')

  it('counts whole days a pending request has been waiting', () => {
    expect(pendingAgeInDays('2026-09-24T12:00:00.000Z', 'pending', now)).toBe(2)
  })

  it('is zero for a request submitted today', () => {
    expect(pendingAgeInDays('2026-09-26T09:00:00.000Z', 'pending', now)).toBe(0)
  })

  it('never goes negative when the clock disagrees with the stored timestamp', () => {
    expect(pendingAgeInDays('2026-09-27T12:00:00.000Z', 'pending', now)).toBe(0)
  })

  it('is null once a request is decided or has no usable timestamp', () => {
    expect(pendingAgeInDays('2026-09-24T12:00:00.000Z', 'approved', now)).toBeNull()
    expect(pendingAgeInDays(null, 'pending', now)).toBeNull()
    expect(pendingAgeInDays('not-a-date', 'pending', now)).toBeNull()
  })
})
