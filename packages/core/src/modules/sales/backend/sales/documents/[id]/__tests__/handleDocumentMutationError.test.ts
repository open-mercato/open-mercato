/**
 * @jest-environment jsdom
 */
const mockSurfaceRecordConflict = jest.fn()

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => mockSurfaceRecordConflict(...args),
}))

import { handleDocumentMutationError } from '../page'

const t = (_key: string, fallback?: string) => fallback ?? _key

describe('handleDocumentMutationError', () => {
  beforeEach(() => {
    mockSurfaceRecordConflict.mockReset()
  })

  it('surfaces the conflict, refreshes, and returns true for an optimistic-lock 409', () => {
    mockSurfaceRecordConflict.mockReturnValue(true)
    const refresh = jest.fn()
    const err = new Error('optimistic_lock_conflict')

    const handled = handleDocumentMutationError(err, t, refresh)

    expect(handled).toBe(true)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledTimes(1)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledWith(err, t, { onRefresh: refresh })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('returns false and does not refresh for a non-conflict error', () => {
    mockSurfaceRecordConflict.mockReturnValue(false)
    const refresh = jest.fn()
    const err = new Error('boom')

    const handled = handleDocumentMutationError(err, t, refresh)

    expect(handled).toBe(false)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })
})
