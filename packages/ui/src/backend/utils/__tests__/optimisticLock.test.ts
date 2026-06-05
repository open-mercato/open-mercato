import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '../optimisticLock'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

describe('buildOptimisticLockHeader', () => {
  it('returns the extension header when updatedAt is a non-empty string', () => {
    expect(buildOptimisticLockHeader('2026-05-25T08:42:18.123Z')).toEqual({
      [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-05-25T08:42:18.123Z',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(buildOptimisticLockHeader('   2026-05-25T08:42:18.123Z   ')).toEqual({
      [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-05-25T08:42:18.123Z',
    })
  })

  it('returns an empty object for null / undefined / empty / whitespace input', () => {
    expect(buildOptimisticLockHeader(null)).toEqual({})
    expect(buildOptimisticLockHeader(undefined)).toEqual({})
    expect(buildOptimisticLockHeader('')).toEqual({})
    expect(buildOptimisticLockHeader('   ')).toEqual({})
  })

  it('returns an empty object for non-string input (defensive)', () => {
    // @ts-expect-error intentional misuse
    expect(buildOptimisticLockHeader(12345)).toEqual({})
    // @ts-expect-error intentional misuse
    expect(buildOptimisticLockHeader({ updatedAt: '2026' })).toEqual({})
  })
})

describe('extractOptimisticLockConflict', () => {
  it('returns the conflict body when the error has status 409 + optimistic-lock code + both timestamps', () => {
    const err = {
      status: 409,
      body: {
        error: 'record_modified',
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        currentUpdatedAt: '2026-05-25T08:42:19.000Z',
        expectedUpdatedAt: '2026-05-25T08:42:18.000Z',
      },
    }
    expect(extractOptimisticLockConflict(err)).toEqual({
      error: 'record_modified',
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: '2026-05-25T08:42:19.000Z',
      expectedUpdatedAt: '2026-05-25T08:42:18.000Z',
    })
  })

  it('returns the conflict body when raiseCrudError attached the response fields directly to the error', () => {
    const err = {
      status: 409,
      error: 'record_modified',
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: '2026-05-25T08:42:19.000Z',
      expectedUpdatedAt: '2026-05-25T08:42:18.000Z',
    }
    expect(extractOptimisticLockConflict(err)).toEqual({
      error: 'record_modified',
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: '2026-05-25T08:42:19.000Z',
      expectedUpdatedAt: '2026-05-25T08:42:18.000Z',
    })
  })

  it('returns null for non-409 errors', () => {
    expect(
      extractOptimisticLockConflict({
        status: 422,
        body: { error: 'validation_failed', code: OPTIMISTIC_LOCK_CONFLICT_CODE },
      }),
    ).toBeNull()
  })

  it('returns null for 409 errors that are not optimistic-lock conflicts', () => {
    expect(
      extractOptimisticLockConflict({
        status: 409,
        body: { error: 'duplicate', code: 'duplicate_resource' },
      }),
    ).toBeNull()
  })

  it('returns null when the conflict body is missing required timestamp fields', () => {
    expect(
      extractOptimisticLockConflict({
        status: 409,
        body: { error: 'record_modified', code: OPTIMISTIC_LOCK_CONFLICT_CODE },
      }),
    ).toBeNull()
    expect(
      extractOptimisticLockConflict({
        status: 409,
        body: {
          error: 'record_modified',
          code: OPTIMISTIC_LOCK_CONFLICT_CODE,
          currentUpdatedAt: 123,
          expectedUpdatedAt: '2026-05-25T08:42:18.000Z',
        },
      }),
    ).toBeNull()
  })

  it('returns null for non-object inputs', () => {
    expect(extractOptimisticLockConflict(null)).toBeNull()
    expect(extractOptimisticLockConflict(undefined)).toBeNull()
    expect(extractOptimisticLockConflict('boom')).toBeNull()
    expect(extractOptimisticLockConflict(409)).toBeNull()
  })

  it('falls back to the canonical error token when body.error is missing', () => {
    const result = extractOptimisticLockConflict({
      status: 409,
      body: {
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        currentUpdatedAt: '2026-05-25T08:42:19.000Z',
        expectedUpdatedAt: '2026-05-25T08:42:18.000Z',
      },
    })
    expect(result?.error).toBe('record_modified')
  })
})
