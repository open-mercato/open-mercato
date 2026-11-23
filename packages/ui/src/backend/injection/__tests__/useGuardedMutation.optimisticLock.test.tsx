/** @jest-environment jsdom */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const triggerEventMock = jest.fn()

jest.mock('../InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({
    triggerEvent: (...args: unknown[]) => triggerEventMock(...args),
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import { act, renderHook } from '@testing-library/react'
import { useGuardedMutation } from '../useGuardedMutation'
import { dismissRecordConflict, getRecordConflictForTest } from '../../conflicts'

function setupTriggerEventOk() {
  triggerEventMock.mockImplementation(async () => ({ ok: true, requestHeaders: undefined }))
}

describe('useGuardedMutation — surfaces optimistic-lock conflict on the unified bar', () => {
  beforeEach(() => {
    triggerEventMock.mockClear()
    dismissRecordConflict()
  })

  it('shows the record-conflict bar when the operation throws CrudHttpError(409, optimistic_lock_conflict)', async () => {
    setupTriggerEventOk()
    const { result } = renderHook(() => useGuardedMutation<Record<string, unknown>>({ contextId: 'test-form' }))
    const conflict = new CrudHttpError(409, {
      error: 'record_modified',
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: '2026-05-25T08:00:01.000Z',
      expectedUpdatedAt: '2026-05-25T08:00:00.000Z',
    })

    await act(async () => {
      try {
        await result.current.runMutation({
          operation: async () => { throw conflict },
          context: {},
          mutationPayload: {},
        })
      } catch (err) {
        expect(err).toBe(conflict)
      }
    })

    const entry = getRecordConflictForTest()
    expect(entry).not.toBeNull()
    expect(entry?.message).toBe('This record was modified by someone else. Refresh and try again.')
    expect(entry?.currentUpdatedAt).toBe('2026-05-25T08:00:01.000Z')
  })

  it('does NOT show the bar for non-optimistic-lock 409s (e.g. plain conflicts)', async () => {
    setupTriggerEventOk()
    const { result } = renderHook(() => useGuardedMutation<Record<string, unknown>>({ contextId: 'test-form' }))
    const otherConflict = new CrudHttpError(409, {
      error: 'duplicate',
      code: 'duplicate_resource',
    })

    await act(async () => {
      try {
        await result.current.runMutation({
          operation: async () => { throw otherConflict },
          context: {},
          mutationPayload: {},
        })
      } catch (err) {
        expect(err).toBe(otherConflict)
      }
    })

    expect(getRecordConflictForTest()).toBeNull()
  })

  it('does NOT show the bar for non-409 errors', async () => {
    setupTriggerEventOk()
    const { result } = renderHook(() => useGuardedMutation<Record<string, unknown>>({ contextId: 'test-form' }))
    const validationError = new CrudHttpError(422, { error: 'validation_failed' })

    await act(async () => {
      try {
        await result.current.runMutation({
          operation: async () => { throw validationError },
          context: {},
          mutationPayload: {},
        })
      } catch (err) {
        expect(err).toBe(validationError)
      }
    })

    expect(getRecordConflictForTest()).toBeNull()
  })

  it('does NOT show the bar when the operation resolves successfully', async () => {
    setupTriggerEventOk()
    const { result } = renderHook(() => useGuardedMutation<Record<string, unknown>>({ contextId: 'test-form' }))

    await act(async () => {
      const value = await result.current.runMutation({
        operation: async () => 'ok',
        context: {},
        mutationPayload: {},
      })
      expect(value).toBe('ok')
    })

    expect(getRecordConflictForTest()).toBeNull()
  })

  it('skips hooks and prevents retry when the write completes after its context changes', async () => {
    setupTriggerEventOk()
    const { result } = renderHook(() => useGuardedMutation({ contextId: 'test-form' }))
    let current = true
    await act(async () => {
      await expect(result.current.runMutation({
        operation: async () => {
          current = false
          return 'saved'
        },
        context: {},
        isCurrent: () => current,
      })).resolves.toBe('saved')
      await expect(result.current.retryLastMutation()).resolves.toBe(false)
    })
    expect(triggerEventMock).toHaveBeenCalledTimes(1)
    expect(triggerEventMock).toHaveBeenCalledWith('onBeforeSave', {}, {})
  })

  it('does not dispatch a write after its context changes during the before-save hook', async () => {
    let current = true
    triggerEventMock.mockImplementation(async () => {
      current = false
      return { ok: true }
    })
    const { result } = renderHook(() => useGuardedMutation({ contextId: 'test-form' }))
    const operation = jest.fn(async () => 'saved')

    await expect(result.current.runMutation({
      operation,
      context: {},
      isCurrent: () => current,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(operation).not.toHaveBeenCalled()
  })
})
