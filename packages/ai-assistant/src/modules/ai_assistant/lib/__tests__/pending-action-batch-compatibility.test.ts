import { describe, expect, it } from '@jest/globals'
import { planPendingActionExecution, type PendingActionExecutionPlan } from '../pending-action-batch'

describe('pending action execution plan compatibility', () => {
  it('keeps the stored input for existing three-argument callers', () => {
    const normalizedInput = { patch: { title: 'Approved' } }
    const action = { normalizedInput, records: null, recordVersion: 'v1', targetRecordId: 'record-1' }

    expect(planPendingActionExecution(action, {}, null)).toMatchObject({
      kind: 'run',
      input: normalizedInput,
      expectedRecordVersions: { 'record-1': 'v1' },
    })
  })

  it('keeps existing run-plan values assignable without the new record IDs', () => {
    const plan: PendingActionExecutionPlan = {
      kind: 'run',
      input: {},
      expectedRecordVersions: {},
      notPreviewedRecordIds: [],
      droppedDuplicateRecordIds: [],
    }

    expect(plan.kind).toBe('run')
  })
})
