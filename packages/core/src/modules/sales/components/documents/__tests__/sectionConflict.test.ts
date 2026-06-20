/**
 * @jest-environment jsdom
 */
const mockSurfaceRecordConflict = jest.fn()

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => mockSurfaceRecordConflict(...args),
}))

import { handleSectionMutationError, readRowUpdatedAt, rowOptimisticVersion } from '../optimisticLock'

const t = (_key: string, fallback?: string) => fallback ?? _key

describe('readRowUpdatedAt', () => {
  it('reads snake_case updated_at, then camelCase updatedAt', () => {
    expect(readRowUpdatedAt({ updated_at: '2026-05-29T00:00:00.000Z' })).toBe('2026-05-29T00:00:00.000Z')
    expect(readRowUpdatedAt({ updatedAt: '2026-05-29T01:00:00.000Z' })).toBe('2026-05-29T01:00:00.000Z')
    expect(readRowUpdatedAt({ updated_at: '2026-05-29T00:00:00.000Z', updatedAt: 'ignored' })).toBe('2026-05-29T00:00:00.000Z')
  })

  it('returns null for missing/empty/non-object inputs', () => {
    expect(readRowUpdatedAt({})).toBeNull()
    expect(readRowUpdatedAt({ updated_at: '' })).toBeNull()
    expect(readRowUpdatedAt(null)).toBeNull()
    expect(readRowUpdatedAt(undefined)).toBeNull()
    expect(readRowUpdatedAt('nope')).toBeNull()
  })
})

describe('handleSectionMutationError', () => {
  beforeEach(() => {
    mockSurfaceRecordConflict.mockReset()
  })

  it('surfaces the conflict, refreshes, and returns true for an optimistic-lock 409', () => {
    mockSurfaceRecordConflict.mockReturnValue(true)
    const refresh = jest.fn()
    const err = new Error('optimistic_lock_conflict')

    const handled = handleSectionMutationError(err, t, refresh)

    expect(handled).toBe(true)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledTimes(1)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledWith(err, t, { onRefresh: refresh })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('returns false and does not refresh for a non-conflict error', () => {
    mockSurfaceRecordConflict.mockReturnValue(false)
    const refresh = jest.fn()
    const err = new Error('boom')

    const handled = handleSectionMutationError(err, t, refresh)

    expect(handled).toBe(false)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('rowOptimisticVersion', () => {
  it("returns the row's own updatedAt when present", () => {
    expect(rowOptimisticVersion({ updatedAt: '2026-05-29T10:00:00.000Z' })).toBe('2026-05-29T10:00:00.000Z')
  })

  it('returns undefined when updatedAt is missing or empty', () => {
    expect(rowOptimisticVersion(null)).toBeUndefined()
    expect(rowOptimisticVersion(undefined)).toBeUndefined()
    expect(rowOptimisticVersion({ updatedAt: null })).toBeUndefined()
    expect(rowOptimisticVersion({ updatedAt: '' })).toBeUndefined()
  })
})
