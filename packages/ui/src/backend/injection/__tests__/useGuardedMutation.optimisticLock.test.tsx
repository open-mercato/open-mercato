/** @jest-environment jsdom */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const triggerEventMock = jest.fn()
let mockReplacementTriggerEvent: typeof triggerEventMock | null = null

jest.mock('../InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({
    triggerEvent: mockReplacementTriggerEvent ?? triggerEventMock,
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import { act, renderHook } from '@testing-library/react'
import { useGuardedMutation } from '../useGuardedMutation'
import { dismissRecordConflict, getRecordConflictForTest } from '../../conflicts'
import { BACKEND_MUTATION_ERROR_EVENT, type BackendMutationErrorEventDetail } from '../mutationEvents'

function setupTriggerEventOk() {
  triggerEventMock.mockImplementation(async () => ({ ok: true, requestHeaders: undefined }))
}

describe('useGuardedMutation — surfaces optimistic-lock conflict on the unified bar', () => {
  beforeEach(() => {
    triggerEventMock.mockClear()
    mockReplacementTriggerEvent = null
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

  it('replays the original write through the currently registered guards', async () => {
    triggerEventMock.mockResolvedValueOnce({ ok: false, message: 'blocked' })
    const { result, rerender } = renderHook(() => useGuardedMutation({ contextId: 'original-form' }))
    const operation = jest.fn(async (_headers?: Readonly<Record<string, string>>) => 'old write')
    const onSuccess = jest.fn()
    const payload = { pipelineStageId: 'stage-2' }
    const context = { formId: 'original-form', resourceId: 'deal-1' }
    const errors: BackendMutationErrorEventDetail[] = []
    const captureError = (event: Event) => { errors.push((event as CustomEvent<BackendMutationErrorEventDetail>).detail) }
    window.addEventListener(BACKEND_MUTATION_ERROR_EVENT, captureError)

    try {
      await expect(result.current.runMutation({
        operation, context, mutationPayload: payload, headerMode: 'request-local', onSuccess,
      })).rejects.toThrow('blocked')
      expect(onSuccess).not.toHaveBeenCalled()
      mockReplacementTriggerEvent = jest.fn().mockResolvedValue({ ok: true })
      rerender()
      await result.current.runMutation({ operation: async () => 'new write', context })
      mockReplacementTriggerEvent.mockClear()
      mockReplacementTriggerEvent.mockResolvedValueOnce({ ok: true, requestHeaders: { 'x-sudo-token': 'retry' } })

      await expect(errors[0].retryMutation?.('active-form')).resolves.toBe(true)

      expect(mockReplacementTriggerEvent).toHaveBeenNthCalledWith(
        1, 'onBeforeSave', payload, { ...context, formId: 'active-form' },
      )
      expect(mockReplacementTriggerEvent).toHaveBeenNthCalledWith(
        2, 'onAfterSave', payload, { ...context, formId: 'active-form' },
      )
      expect(operation.mock.calls).toEqual([[{ 'x-sudo-token': 'retry' }]])
      expect(onSuccess).toHaveBeenCalledTimes(1)
    } finally {
      mockReplacementTriggerEvent = null
      window.removeEventListener(BACKEND_MUTATION_ERROR_EVENT, captureError)
    }
  })
})

it('passes new request-local guard headers directly on retry', async () => {
  const run = jest.fn(async (_headers?: Readonly<Record<string, string>>) => undefined)
  triggerEventMock.mockResolvedValueOnce({ ok: true, requestHeaders: { 'x-sudo-token': 'first' } })
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: true, requestHeaders: { 'x-sudo-token': 'retry' } })
    .mockResolvedValueOnce({ ok: true })
  const { result } = renderHook(() => useGuardedMutation({ contextId: 'test-form' }))
  await act(async () => {
    await result.current.runMutation({ context: {}, operation: run, headerMode: 'request-local' })
    await result.current.retryLastMutation()
  })
  expect(run.mock.calls).toEqual([[{ 'x-sudo-token': 'first' }], [{ 'x-sudo-token': 'retry' }]])
})
