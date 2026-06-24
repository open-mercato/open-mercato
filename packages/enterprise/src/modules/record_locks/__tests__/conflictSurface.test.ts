import { isOssOptimisticLockConflict } from '../lib/conflictSurface'
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
