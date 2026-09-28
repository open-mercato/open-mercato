/** @jest-environment node */
/**
 * Pins the workflow form's mapping and payload.
 *
 * The trap this file exists for is `entityType`: it is a free string the engine compares, so a form
 * that let it drift (or dropped it on save) would produce a workflow that is never selected. The
 * version also has to survive into `initialValues`, or the edit screen loses optimistic locking.
 */
import {
  buildApprovalWorkflowFormDefaults,
  toApprovalWorkflowFormValues,
  toApprovalWorkflowPayload,
} from '../ApprovalWorkflowForm'
import type { ApprovalWorkflowRow } from '../ApprovalWorkflowsTable'

const UPDATED_AT = '2026-09-27T10:00:00.000Z'

function workflow(overrides: Partial<ApprovalWorkflowRow> = {}): ApprovalWorkflowRow {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    name: 'Leave approval',
    code: 'LEAVE-V1',
    entity_type: 'hr_leave_request',
    description: 'Manager then HR',
    is_active: true,
    updated_at: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('approval workflow form values', () => {
  it('threads the record version so the edit form locks', () => {
    expect(toApprovalWorkflowFormValues(workflow()).updatedAt).toBe(UPDATED_AT)
    expect(toApprovalWorkflowFormValues(workflow({ updatedAt: undefined })).updatedAt).toBe(UPDATED_AT)
    expect(toApprovalWorkflowFormValues(workflow({ updatedAt: undefined, updated_at: undefined })).updatedAt).toBeNull()
  })

  it('maps snake_case columns into form values', () => {
    const values = toApprovalWorkflowFormValues(workflow())
    expect(values).toMatchObject({
      name: 'Leave approval',
      code: 'LEAVE-V1',
      entityType: 'hr_leave_request',
      description: 'Manager then HR',
      isActive: true,
    })
    expect(values).not.toHaveProperty('entity_type')
  })

  it('treats an absent is_active as active, matching the column default', () => {
    expect(toApprovalWorkflowFormValues(workflow({ is_active: null })).isActive).toBe(true)
    expect(toApprovalWorkflowFormValues(workflow({ is_active: false })).isActive).toBe(false)
  })

  it('starts a new workflow on an implemented target', () => {
    const defaults = buildApprovalWorkflowFormDefaults()
    expect(defaults.entityType).toBe('hr_leave_request')
    expect(defaults.isActive).toBe(true)
    expect(defaults.updatedAt).toBeNull()
  })
})

describe('approval workflow payload', () => {
  it('sends the chosen target, trimmed text and the active flag', () => {
    const payload = toApprovalWorkflowPayload({
      ...buildApprovalWorkflowFormDefaults(),
      name: '  Attendance approval  ',
      code: '  ATT-V1  ',
      entityType: 'hr_attendance_record',
      description: '  HR reviews lateness  ',
      isActive: false,
    })

    expect(payload).toEqual({
      name: 'Attendance approval',
      code: 'ATT-V1',
      entityType: 'hr_attendance_record',
      description: 'HR reviews lateness',
      isActive: false,
    })
  })

  it('clears an empty description with null so an update can remove it', () => {
    const payload = toApprovalWorkflowPayload({ ...buildApprovalWorkflowFormDefaults(), description: '   ' })
    expect(payload.description).toBeNull()
  })

  it('never sends the record id', () => {
    expect(toApprovalWorkflowPayload(buildApprovalWorkflowFormDefaults('00000000-0000-4000-8000-0000000000c1')))
      .not.toHaveProperty('id')
  })
})
