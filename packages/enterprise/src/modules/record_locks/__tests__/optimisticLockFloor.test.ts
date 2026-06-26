import {
  classifyUnmatchedSaveError,
  isOptimisticLockFloorConflict,
} from '../lib/optimisticLockFloor'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * Regression guard for issue #3504: on the standard makeCrudRoute / CrudForm save
 * path a concurrent-edit 409 is an OSS optimistic-lock-floor conflict, already
 * owned by the shared conflict bar. The record-lock widget must defer to that bar
 * for these 409s rather than open a second, degraded merge dialog (single-surface
 * invariant S3). Ownership is decided by `isOptimisticLockFloorConflict`, which must
 * be true only for OSS optimistic-lock 409s and false for genuine record-lock
 * conflicts and everything else.
 */
describe('isOptimisticLockFloorConflict', () => {
  const optimisticLockBody = {
    error: 'record_modified',
    code: OPTIMISTIC_LOCK_CONFLICT_CODE,
    currentUpdatedAt: '2026-06-24T10:00:01.000Z',
    expectedUpdatedAt: '2026-06-24T10:00:00.000Z',
  }

  it('is true for an OSS optimistic-lock 409 with a nested body (CrudForm shape)', () => {
    expect(isOptimisticLockFloorConflict({ status: 409, body: optimisticLockBody })).toBe(true)
  })

  it('is true for an OSS optimistic-lock 409 with fields attached directly to the error', () => {
    expect(isOptimisticLockFloorConflict({ status: 409, ...optimisticLockBody })).toBe(true)
  })

  it('is false for a genuine record-lock conflict 409 (merge dialog owns it)', () => {
    expect(
      isOptimisticLockFloorConflict({
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

  it('is false for a 409 carrying the code but missing the updated-at timestamps', () => {
    expect(
      isOptimisticLockFloorConflict({
        status: 409,
        body: { error: 'record_modified', code: OPTIMISTIC_LOCK_CONFLICT_CODE },
      }),
    ).toBe(false)
  })

  it('is false when the optimistic-lock code rides a non-409 status', () => {
    expect(isOptimisticLockFloorConflict({ status: 422, body: optimisticLockBody })).toBe(false)
  })

  it('is false for nullish and non-object inputs', () => {
    expect(isOptimisticLockFloorConflict(null)).toBe(false)
    expect(isOptimisticLockFloorConflict(undefined)).toBe(false)
    expect(isOptimisticLockFloorConflict('boom')).toBe(false)
  })
})

/**
 * Wiring guard for issue #3504: the predicate above proves classification, but the
 * bug lived in which surface the widget's `onCrudSaveError` listener drives for a
 * save error that produced no record_lock_conflict payload. That decision is
 * extracted to `classifyUnmatchedSaveError`; these cases lock in that an OSS
 * optimistic-lock 409 defers to the shared conflict bar (no merge dialog), while
 * other 409s keep the fallback dialog and non-409s are ignored.
 */
describe('classifyUnmatchedSaveError', () => {
  const optimisticLock409 = {
    status: 409,
    body: {
      error: 'record_modified',
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: '2026-06-24T10:00:01.000Z',
      expectedUpdatedAt: '2026-06-24T10:00:00.000Z',
    },
  }

  it('defers an OSS optimistic-lock 409 to the shared conflict bar (no merge dialog)', () => {
    expect(classifyUnmatchedSaveError(optimisticLock409, 409)).toBe('defer-to-conflict-bar')
  })

  it('opens the fallback merge dialog for a 409 that is not an optimistic-lock conflict', () => {
    expect(classifyUnmatchedSaveError({ status: 409, body: { error: 'conflict' } }, 409)).toBe(
      'fallback-merge-dialog',
    )
  })

  it('ignores a non-409 error (no conflict surface for this widget to drive)', () => {
    expect(classifyUnmatchedSaveError({ status: 422 }, 422)).toBe('ignore')
  })

  it('ignores when the listener could not resolve an error status', () => {
    expect(classifyUnmatchedSaveError(optimisticLock409, null)).toBe('ignore')
  })
})
