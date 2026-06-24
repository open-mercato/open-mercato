import {
  decideCrudSaveErrorAction,
  isOssOptimisticLockConflict,
  type CrudSaveErrorDecisionInput,
} from '../lib/conflictSurface'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * Regression guard for issue #3504: on the standard makeCrudRoute / CrudForm
 * save path a concurrent-edit 409 is an OSS optimistic-lock conflict, already
 * surfaced on the shared OSS conflict bar. The record-lock widget must NOT also
 * open its merge dialog for that 409 (single-surface invariant S3). It decides
 * via `isOssOptimisticLockConflict`, which must be true only for OSS
 * optimistic-lock conflicts and false for genuine record-lock conflicts.
 */
describe('isOssOptimisticLockConflict', () => {
  it('is true for an OSS optimistic-lock 409 with a nested body (CrudForm shape)', () => {
    expect(
      isOssOptimisticLockConflict({
        status: 409,
        body: {
          error: 'record_modified',
          code: OPTIMISTIC_LOCK_CONFLICT_CODE,
          currentUpdatedAt: '2026-06-24T10:00:01.000Z',
          expectedUpdatedAt: '2026-06-24T10:00:00.000Z',
        },
      }),
    ).toBe(true)
  })

  it('is true for an OSS optimistic-lock 409 with fields attached directly to the error', () => {
    expect(
      isOssOptimisticLockConflict({
        status: 409,
        error: 'record_modified',
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        currentUpdatedAt: '2026-06-24T10:00:01.000Z',
        expectedUpdatedAt: '2026-06-24T10:00:00.000Z',
      }),
    ).toBe(true)
  })

  it('is false for a genuine record-lock conflict 409 (merge dialog owns it)', () => {
    expect(
      isOssOptimisticLockConflict({
        status: 409,
        body: {
          error: 'record_lock_conflict',
          code: 'record_lock_conflict',
          conflictId: 'a0000000-0000-4000-8000-000000000001',
          resourceKind: 'catalog.product',
          resourceId: 'b0000000-0000-4000-8000-000000000001',
          resolutionOptions: ['accept_mine'],
        },
      }),
    ).toBe(false)
  })

  it('is false for a 409 carrying lock markers but no optimistic-lock code', () => {
    expect(
      isOssOptimisticLockConflict({
        status: 409,
        body: {
          conflict: { id: 'c0000000-0000-4000-8000-000000000001' },
          resourceKind: 'customers.company',
          resourceId: 'd0000000-0000-4000-8000-000000000001',
        },
      }),
    ).toBe(false)
  })

  it('is false for non-409 errors and non-object inputs', () => {
    expect(
      isOssOptimisticLockConflict({
        status: 422,
        body: { error: 'validation_failed', code: OPTIMISTIC_LOCK_CONFLICT_CODE },
      }),
    ).toBe(false)
    expect(isOssOptimisticLockConflict(null)).toBe(false)
    expect(isOssOptimisticLockConflict(undefined)).toBe(false)
    expect(isOssOptimisticLockConflict('boom')).toBe(false)
  })
})

/**
 * Wiring guard for issue #3504: the predicate test above proves classification,
 * but the actual bug lived in the widget's `onCrudSaveError` listener — which
 * surface it drives for a save error. That decision is extracted to
 * `decideCrudSaveErrorAction`; these cases lock in that an OSS optimistic-lock
 * 409 defers to the shared conflict bar (never opens the merge dialog), while
 * genuine record-lock conflicts and other 409s keep their prior behavior.
 */
describe('decideCrudSaveErrorAction', () => {
  const ossOptimisticLock409 = {
    status: 409,
    body: {
      error: 'record_modified',
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: '2026-06-24T10:00:01.000Z',
      expectedUpdatedAt: '2026-06-24T10:00:00.000Z',
    },
  }

  const baseInput: CrudSaveErrorDecisionInput = {
    error: { status: 409 },
    eventTargetsCurrentForm: true,
    hasRecordLockPayload: false,
    payloadResourceKind: null,
    payloadResourceId: null,
    currentResourceKind: 'catalog.product',
    currentResourceId: 'b0000000-0000-4000-8000-000000000001',
    isRecordDeleted: false,
    errorStatus: 409,
  }

  it('defers an OSS optimistic-lock 409 to the shared conflict bar (does NOT open the merge dialog)', () => {
    expect(
      decideCrudSaveErrorAction({
        ...baseInput,
        error: ossOptimisticLock409,
        errorStatus: 409,
      }),
    ).toBe('defer-to-oss-conflict-bar')
  })

  it('opens the fallback merge dialog for a 409 that is not an OSS optimistic-lock conflict', () => {
    expect(
      decideCrudSaveErrorAction({
        ...baseInput,
        error: { status: 409, body: { error: 'conflict' } },
        errorStatus: 409,
      }),
    ).toBe('open-fallback-dialog')
  })

  it('applies the record-lock payload when one is present (merge dialog owns it)', () => {
    expect(
      decideCrudSaveErrorAction({
        ...baseInput,
        hasRecordLockPayload: true,
        payloadResourceKind: 'catalog.product',
        payloadResourceId: 'b0000000-0000-4000-8000-000000000001',
      }),
    ).toBe('apply-record-lock-payload')
  })

  it('reports record-deleted before considering any 409 surface', () => {
    expect(
      decideCrudSaveErrorAction({
        ...baseInput,
        isRecordDeleted: true,
      }),
    ).toBe('record-deleted')
  })

  it('ignores a non-409 error without a record-lock payload', () => {
    expect(
      decideCrudSaveErrorAction({
        ...baseInput,
        error: { status: 422 },
        errorStatus: 422,
      }),
    ).toBe('ignore')
  })

  it('ignores when the current form has no record identity', () => {
    expect(
      decideCrudSaveErrorAction({
        ...baseInput,
        currentResourceKind: null,
        currentResourceId: null,
      }),
    ).toBe('ignore')
  })

  it('ignores an event targeting a different form whose payload does not match this record', () => {
    expect(
      decideCrudSaveErrorAction({
        ...baseInput,
        eventTargetsCurrentForm: false,
        hasRecordLockPayload: true,
        payloadResourceKind: 'customers.company',
        payloadResourceId: 'd0000000-0000-4000-8000-000000000002',
      }),
    ).toBe('ignore')
  })

  it('applies a cross-form record-lock payload that matches this record', () => {
    expect(
      decideCrudSaveErrorAction({
        ...baseInput,
        eventTargetsCurrentForm: false,
        hasRecordLockPayload: true,
        payloadResourceKind: 'catalog.product',
        payloadResourceId: 'b0000000-0000-4000-8000-000000000001',
      }),
    ).toBe('apply-record-lock-payload')
  })
})
