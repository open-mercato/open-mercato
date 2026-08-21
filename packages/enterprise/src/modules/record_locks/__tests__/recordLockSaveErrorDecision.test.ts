import { resolveRecordLockSaveErrorDecision } from '../widgets/injection/record-locking/widget.client'
import {
  surfaceRecordConflict,
  getRecordConflictForTest,
  dismissRecordConflict,
} from '@open-mercato/ui/backend/conflicts'

const formId = 'record-lock:test-form'
const resourceKind = 'catalog.product'
const resourceId = 'b0000000-0000-4000-8000-000000000001'
const currentState = { resourceKind, resourceId }

// The exact shape a `makeCrudRoute` / `CrudForm` save returns on a stale write —
// the OSS optimistic-lock floor (NOT the enterprise `record_lock_conflict`).
const ossOptimisticLockError = {
  status: 409,
  body: {
    error: 'record_modified',
    code: 'optimistic_lock_conflict',
    currentUpdatedAt: '2026-06-22T10:00:00.000Z',
    expectedUpdatedAt: '2026-06-22T09:00:00.000Z',
  },
}

describe('resolveRecordLockSaveErrorDecision (single conflict surface, S3)', () => {
  test('defers a plain OSS optimistic_lock_conflict 409 to the OSS conflict bar — no second surface (#3504/#3505)', () => {
    const decision = resolveRecordLockSaveErrorDecision({
      error: ossOptimisticLockError,
      eventContextId: formId,
      formId,
      currentState,
    })
    // Before the fix this returned `fallback-dialog`, opening the degraded merge
    // dialog ON TOP of the OSS bar (two surfaces, #3504) with an empty,
    // non-functional dialog (#3505).
    expect(decision.action).toBe('ignore')
  })

  test('opens the merge dialog for a genuine record_lock_conflict payload', () => {
    const recordLockError = {
      status: 409,
      body: {
        code: 'record_lock_conflict',
        conflict: {
          id: 'a0000000-0000-4000-8000-000000000001',
          resourceKind,
          resourceId,
          baseActionLogId: null,
          incomingActionLogId: null,
          allowIncomingOverride: false,
          canOverrideIncoming: false,
          resolutionOptions: [],
          changes: [{ field: 'name', incomingValue: 'A', mineValue: 'B' }],
        },
      },
    }
    const decision = resolveRecordLockSaveErrorDecision({
      error: recordLockError,
      eventContextId: formId,
      formId,
      currentState,
    })
    expect(decision.action).toBe('apply-conflict')
    if (decision.action === 'apply-conflict') {
      expect(decision.payload.conflict.resourceKind).toBe(resourceKind)
      expect(decision.payload.conflict.changes).toHaveLength(1)
    }
  })

  test('flags a record-deleted error', () => {
    const decision = resolveRecordLockSaveErrorDecision({
      error: { status: 404, body: { code: 'record_not_found' } },
      eventContextId: formId,
      formId,
      currentState,
    })
    expect(decision.action).toBe('record-deleted')
  })

  test('opens the fallback dialog for an unrecognized 409 (legacy behavior preserved)', () => {
    const decision = resolveRecordLockSaveErrorDecision({
      error: { status: 409, body: { code: 'some_other_conflict' } },
      eventContextId: formId,
      formId,
      currentState,
    })
    expect(decision.action).toBe('fallback-dialog')
  })

  test('ignores when there is no mounted record state', () => {
    const decision = resolveRecordLockSaveErrorDecision({
      error: ossOptimisticLockError,
      eventContextId: formId,
      formId,
      currentState: null,
    })
    expect(decision.action).toBe('ignore')
  })

  test('ignores a cross-form event whose record does not match the mounted record', () => {
    const decision = resolveRecordLockSaveErrorDecision({
      error: {
        status: 409,
        body: {
          code: 'record_lock_conflict',
          conflict: {
            id: 'a0000000-0000-4000-8000-000000000002',
            resourceKind: 'customers.deal',
            resourceId: 'c0000000-0000-4000-8000-000000000009',
            changes: [],
          },
        },
      },
      eventContextId: 'record-lock:other-form',
      formId,
      currentState,
    })
    expect(decision.action).toBe('ignore')
  })
})

describe('CrudForm save-409 shows exactly ONE conflict surface with enterprise enabled', () => {
  afterEach(() => {
    dismissRecordConflict()
  })

  test('the OSS bar owns the surface and the enterprise widget defers (no second surface)', () => {
    const translate = (_key: string, fallback?: string) => fallback ?? _key

    // 1. The OSS conflict bar surfaces the OSS optimistic-lock 409 (surface #1).
    const surfaced = surfaceRecordConflict(ossOptimisticLockError, translate)
    expect(surfaced).toBe(true)
    expect(getRecordConflictForTest()).not.toBeNull()

    // 2. The enterprise record-lock widget defers the SAME error instead of also
    //    opening its merge dialog — so there is no second surface.
    const decision = resolveRecordLockSaveErrorDecision({
      error: ossOptimisticLockError,
      eventContextId: formId,
      formId,
      currentState,
    })
    expect(decision.action).toBe('ignore')
  })
})
