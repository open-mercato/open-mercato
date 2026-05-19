/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'

jest.mock('../../../backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
}))

import { apiCallOrThrow } from '../../../backend/utils/apiCall'
import { useAiPendingActionPolling } from '../useAiPendingActionPolling'
import type { AiPendingActionCardAction, AiPendingActionCardStatus } from '../types'

function makeAction(
  overrides: Partial<AiPendingActionCardAction> = {},
): AiPendingActionCardAction {
  return {
    id: 'pa-1',
    agentId: 'customers.account_assistant',
    toolName: 'customers.update_person',
    status: 'pending',
    fieldDiff: [],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    attachmentIds: [],
    targetEntityType: 'customers.person',
    targetRecordId: 'p-1',
    recordVersion: '1',
    executionResult: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  }
}

function mockResponse(action: AiPendingActionCardAction) {
  ;(apiCallOrThrow as jest.Mock).mockImplementation(async () => ({
    ok: true,
    status: 200,
    result: { pendingAction: action },
    response: {},
    cacheStatus: null,
  }))
}

describe('useAiPendingActionPolling', () => {
  beforeEach(() => {
    ;(apiCallOrThrow as jest.Mock).mockReset()
  })

  it('fetches on mount and continues polling while status is pending', async () => {
    let status: AiPendingActionCardStatus = 'pending'
    ;(apiCallOrThrow as jest.Mock).mockImplementation(async () => ({
      ok: true,
      status: 200,
      result: { pendingAction: makeAction({ status }) },
      response: {},
      cacheStatus: null,
    }))

    jest.useFakeTimers()
    try {
      const { result, unmount } = renderHook(() =>
        useAiPendingActionPolling({ pendingActionId: 'pa-1', intervalMs: 1000 }),
      )

      // Flush the promise chain kicked off on mount.
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(apiCallOrThrow).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('pending')

      await act(async () => {
        jest.advanceTimersByTime(1000)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect((apiCallOrThrow as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2)

      status = 'confirmed'
      await act(async () => {
        jest.advanceTimersByTime(1000)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.status).toBe('confirmed')
      const callsAfterTerminal = (apiCallOrThrow as jest.Mock).mock.calls.length

      await act(async () => {
        jest.advanceTimersByTime(5000)
        await Promise.resolve()
      })
      expect((apiCallOrThrow as jest.Mock).mock.calls.length).toBe(callsAfterTerminal)
      expect(result.current.isPolling).toBe(false)

      unmount()
    } finally {
      jest.useRealTimers()
    }
  })

  it('refresh() force-fetches and updates state', async () => {
    mockResponse(makeAction({ status: 'pending' }))
    const { result } = renderHook(() =>
      useAiPendingActionPolling({ pendingActionId: 'pa-1', intervalMs: 99999 }),
    )

    await waitFor(() => expect(result.current.action?.status).toBe('pending'))

    ;(apiCallOrThrow as jest.Mock).mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      result: { pendingAction: makeAction({ status: 'confirmed' }) },
      response: {},
      cacheStatus: null,
    }))

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.action?.status).toBe('confirmed')
  })

  it('clears outstanding timers when unmounted mid-poll', async () => {
    jest.useFakeTimers()
    try {
      mockResponse(makeAction({ status: 'pending' }))
      const { unmount } = renderHook(() =>
        useAiPendingActionPolling({ pendingActionId: 'pa-1', intervalMs: 1000 }),
      )
      await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledTimes(1))
      unmount()
      const callsAtUnmount = (apiCallOrThrow as jest.Mock).mock.calls.length
      // Advance well past several intervals — no more calls must be fired.
      await act(async () => {
        jest.advanceTimersByTime(10_000)
      })
      expect((apiCallOrThrow as jest.Mock).mock.calls.length).toBe(callsAtUnmount)
    } finally {
      jest.useRealTimers()
    }
  })
})
