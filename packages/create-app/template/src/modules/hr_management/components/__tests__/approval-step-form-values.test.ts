/** @jest-environment node */
/**
 * Pins the step form's rules.
 *
 * Two failures matter here and both are silent in the UI: a step saved without the approver its type
 * needs can never be decided (the request sits at it forever), and a step that keeps both approver ids
 * looks configured after the type is switched — the one it no longer uses is still set. The payload
 * therefore sends exactly one target, and the client check mirrors the service rule so the operator is
 * told which field to fill.
 */
import {
  APPROVER_TYPE_VALUES,
  assertStepApproverChosen,
  buildApprovalStepFormDefaults,
  toApprovalStepFormValues,
  toApprovalStepPayload,
} from '../ApprovalStepForm'
import type { ApprovalStepRow } from '../ApprovalStepsTable'

const UPDATED_AT = '2026-09-27T10:00:00.000Z'
const WORKFLOW_ID = '00000000-0000-4000-8000-0000000000d1'

function step(overrides: Partial<ApprovalStepRow> = {}): ApprovalStepRow {
  return {
    id: '00000000-0000-4000-8000-0000000000d2',
    workflow_id: WORKFLOW_ID,
    step_order: 2,
    name: 'HR review',
    approver_type: 'user',
    approver_user_id: '00000000-0000-4000-8000-0000000000d3',
    required_approvals: 2,
    is_final: true,
    updated_at: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('approval step form values', () => {
  it('threads the record version so the edit form locks', () => {
    expect(toApprovalStepFormValues(step()).updatedAt).toBe(UPDATED_AT)
    expect(toApprovalStepFormValues(step({ updatedAt: undefined, updated_at: undefined })).updatedAt).toBeNull()
  })

  it('maps snake_case columns into form values', () => {
    const values = toApprovalStepFormValues(step())
    expect(values).toMatchObject({
      workflowId: WORKFLOW_ID,
      stepOrder: '2',
      name: 'HR review',
      approverType: 'user',
      approverUserId: '00000000-0000-4000-8000-0000000000d3',
      requiredApprovals: '2',
      isFinal: true,
    })
    expect(values).not.toHaveProperty('step_order')
  })

  it('defaults the approvals needed to one when the row omits it', () => {
    expect(toApprovalStepFormValues(step({ required_approvals: null })).requiredApprovals).toBe('1')
  })

  it('offers the three approver types the engine resolves', () => {
    expect(APPROVER_TYPE_VALUES).toEqual(['role', 'user', 'manager'])
  })

  it('starts a step on the workflow it was opened from', () => {
    expect(buildApprovalStepFormDefaults('', WORKFLOW_ID).workflowId).toBe(WORKFLOW_ID)
    expect(buildApprovalStepFormDefaults().approverType).toBe('user')
  })
})

describe('approval step payload', () => {
  it('sends only the approver the chosen type uses', () => {
    const userStep = toApprovalStepPayload({
      ...buildApprovalStepFormDefaults('', WORKFLOW_ID),
      stepOrder: '1',
      name: 'Manager',
      approverType: 'user',
      approverUserId: 'user-1',
      approverRoleId: 'role-1',
    })
    expect(userStep.approverUserId).toBe('user-1')
    expect(userStep.approverRoleId).toBeNull()

    const roleStep = toApprovalStepPayload({
      ...buildApprovalStepFormDefaults('', WORKFLOW_ID),
      stepOrder: '1',
      name: 'HR',
      approverType: 'role',
      approverUserId: 'user-1',
      approverRoleId: 'role-1',
    })
    expect(roleStep.approverRoleId).toBe('role-1')
    expect(roleStep.approverUserId).toBeNull()
  })

  it('sends no target at all for a manager step, which the engine resolves', () => {
    const payload = toApprovalStepPayload({
      ...buildApprovalStepFormDefaults('', WORKFLOW_ID),
      stepOrder: '3',
      name: 'Reporting line',
      approverType: 'manager',
    })
    expect(payload.approverUserId).toBeNull()
    expect(payload.approverRoleId).toBeNull()
  })

  it('falls back to sane numbers for an empty or unparseable order', () => {
    const payload = toApprovalStepPayload({
      ...buildApprovalStepFormDefaults('', WORKFLOW_ID),
      stepOrder: 'not-a-number',
      requiredApprovals: '0',
      name: 'Broken',
    })
    expect(payload.stepOrder).toBe(1)
    expect(payload.requiredApprovals).toBe(1)
  })

  it('never sends the record id', () => {
    expect(toApprovalStepPayload(buildApprovalStepFormDefaults('00000000-0000-4000-8000-0000000000d2', WORKFLOW_ID)))
      .not.toHaveProperty('id')
  })
})

describe('assertStepApproverChosen', () => {
  const messages = { userRequired: 'pick a user', roleRequired: 'pick a role' }

  it('accepts a step whose type has its target', () => {
    expect(() => assertStepApproverChosen(
      { ...buildApprovalStepFormDefaults('', WORKFLOW_ID), approverType: 'user', approverUserId: 'user-1' },
      messages,
    )).not.toThrow()
  })

  it('refuses a named-user step without a user, naming the field', () => {
    let thrown: unknown = null
    try {
      assertStepApproverChosen({ ...buildApprovalStepFormDefaults('', WORKFLOW_ID), approverType: 'user' }, messages)
    } catch (error) {
      thrown = error
    }
    expect(thrown).not.toBeNull()
    expect(JSON.stringify(thrown)).toContain('pick a user')
    expect(JSON.stringify(thrown)).toContain('approverUserId')
  })

  it('refuses a role step without a role, naming the field', () => {
    let thrown: unknown = null
    try {
      assertStepApproverChosen({ ...buildApprovalStepFormDefaults('', WORKFLOW_ID), approverType: 'role' }, messages)
    } catch (error) {
      thrown = error
    }
    expect(JSON.stringify(thrown)).toContain('pick a role')
    expect(JSON.stringify(thrown)).toContain('approverRoleId')
  })

  it('allows a manager step, which carries no target', () => {
    expect(() => assertStepApproverChosen(
      { ...buildApprovalStepFormDefaults('', WORKFLOW_ID), approverType: 'manager' },
      messages,
    )).not.toThrow()
  })
})
