/** @jest-environment jsdom */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const flashMock = jest.fn()
const triggerEventMock = jest.fn()

jest.mock('../../FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('../InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({
    triggerEvent: (...args: unknown[]) => triggerEventMock(...args),
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import * as React from 'react'
import { act, renderHook } from '@testing-library/react'
import { useGuardedMutation } from '../useGuardedMutation'

function setupTriggerEventOk() {
  triggerEventMock.mockImplementation(async () => ({ ok: true, requestHeaders: undefined }))
}

describe('useGuardedMutation — default 409 flash on optimistic-lock conflict', () => {
  beforeEach(() => {
    flashMock.mockClear()
    triggerEventMock.mockClear()
  })

  it('surfaces ui.forms.flash.recordModified when the operation throws CrudHttpError(409, optimistic_lock_conflict)', async () => {
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

    expect(flashMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledWith('ui.forms.flash.recordModified', 'error')
  })

  it('does NOT flash for non-optimistic-lock 409s (e.g. plain conflicts)', async () => {
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

    expect(flashMock).not.toHaveBeenCalled()
  })

  it('does NOT flash for non-409 errors', async () => {
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

    expect(flashMock).not.toHaveBeenCalled()
  })

  it('does NOT flash when the operation resolves successfully', async () => {
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

    expect(flashMock).not.toHaveBeenCalled()
  })
})
