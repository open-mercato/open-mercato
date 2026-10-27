/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'

jest.mock('../../../backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

import { createLogger } from '@open-mercato/shared/lib/logger'
import { apiCall } from '../../../backend/utils/apiCall'
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

function mockOkResponse(action: AiPendingActionCardAction) {
  ;(apiCall as jest.Mock).mockImplementation(async () => ({
    ok: true,
    status: 200,
    result: { pendingAction: action },
    response: {},
    cacheStatus: null,
  }))
}

function mockStatusResponse(status: number) {
  return {
    ok: false,
    status,
    result: null,
    response: {},
    cacheStatus: null,
  }
}

function setDocumentVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
}

const loggerError = createLogger('ui').error as jest.Mock

describe('useAiPendingActionPolling', () => {
  beforeEach(() => {
    ;(apiCall as jest.Mock).mockReset()
    loggerError.mockClear()
    setDocumentVisibility('visible')
  })

  it('fetches on mount and continues polling while status is pending', async () => {
    let status: AiPendingActionCardStatus = 'pending'
    ;(apiCall as jest.Mock).mockImplementation(async () => ({
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
      expect(apiCall).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('pending')

      await act(async () => {
        jest.advanceTimersByTime(1000)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect((apiCall as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2)

      status = 'confirmed'
      await act(async () => {
        jest.advanceTimersByTime(1000)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.status).toBe('confirmed')
      const callsAfterTerminal = (apiCall as jest.Mock).mock.calls.length

      await act(async () => {
        jest.advanceTimersByTime(5000)
        await Promise.resolve()
      })
      expect((apiCall as jest.Mock).mock.calls.length).toBe(callsAfterTerminal)
      expect(result.current.isPolling).toBe(false)

      unmount()
    } finally {
      jest.useRealTimers()
    }
  })

  it('refresh() force-fetches and updates state', async () => {
    mockOkResponse(makeAction({ status: 'pending' }))
    const { result } = renderHook(() =>
      useAiPendingActionPolling({ pendingActionId: 'pa-1', intervalMs: 99999 }),
    )

    await waitFor(() => expect(result.current.action?.status).toBe('pending'))

    ;(apiCall as jest.Mock).mockImplementationOnce(async () => ({
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
      mockOkResponse(makeAction({ status: 'pending' }))
      const { unmount } = renderHook(() =>
        useAiPendingActionPolling({ pendingActionId: 'pa-1', intervalMs: 1000 }),
      )
      await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))
      unmount()
      const callsAtUnmount = (apiCall as jest.Mock).mock.calls.length
      // Advance well past several intervals — no more calls must be fired.
      await act(async () => {
        jest.advanceTimersByTime(10_000)
      })
      expect((apiCall as jest.Mock).mock.calls.length).toBe(callsAtUnmount)
    } finally {
      jest.useRealTimers()
    }
  })

  it('logs a failed fetch and keeps polling (with backoff) until it recovers', async () => {
    const failure = new Error('[internal] pending action endpoint unreachable')
    ;(apiCall as jest.Mock)
      .mockImplementationOnce(async () => {
        throw failure
      })
      .mockImplementation(async () => ({
        ok: true,
        status: 200,
        result: { pendingAction: makeAction({ status: 'pending' }) },
        response: {},
        cacheStatus: null,
      }))

    jest.useFakeTimers()
    try {
      const { result, unmount } = renderHook(() =>
        useAiPendingActionPolling({ pendingActionId: 'pa-1', intervalMs: 1000 }),
      )

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(loggerError).toHaveBeenCalledWith('Failed to load the pending AI action', {
        err: failure,
        pendingActionId: 'pa-1',
      })
      expect(result.current.error?.message).toBe(failure.message)
      expect(result.current.action).toBeNull()

      // First retry after a failure backs off to intervalMs * 2.
      await act(async () => {
        jest.advanceTimersByTime(2000)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.action?.status).toBe('pending')
      expect(result.current.error).toBeNull()

      unmount()
    } finally {
      jest.useRealTimers()
    }
  })

  it('stops polling on a 404 and reports error.code=not_found', async () => {
    ;(apiCall as jest.Mock).mockImplementation(async () => mockStatusResponse(404))

    jest.useFakeTimers()
    try {
      const { result, unmount } = renderHook(() =>
        useAiPendingActionPolling({ pendingActionId: 'pa-1', intervalMs: 1000 }),
      )

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.error?.code).toBe('not_found')
      expect(result.current.isPolling).toBe(false)
      const callsAfterNotFound = (apiCall as jest.Mock).mock.calls.length

      await act(async () => {
        jest.advanceTimersByTime(60_000)
        await Promise.resolve()
      })
      expect((apiCall as jest.Mock).mock.calls.length).toBe(callsAfterNotFound)

      unmount()
    } finally {
      jest.useRealTimers()
    }
  })

  it('backs off exponentially on repeated 500s and stops after 5 consecutive failures', async () => {
    ;(apiCall as jest.Mock).mockImplementation(async () => mockStatusResponse(500))

    jest.useFakeTimers()
    try {
      const { result, unmount } = renderHook(() =>
        useAiPendingActionPolling({ pendingActionId: 'pa-1', intervalMs: 1000 }),
      )

      // Initial fetch (failure #1), then drive through failures #2-#5 by
      // advancing past each capped backoff delay.
      for (let i = 0; i < 5; i += 1) {
        await act(async () => {
          jest.advanceTimersByTime(60_000)
          await Promise.resolve()
          await Promise.resolve()
        })
      }

      expect(result.current.isPolling).toBe(false)
      const callsAfterStop = (apiCall as jest.Mock).mock.calls.length
      expect(callsAfterStop).toBeGreaterThanOrEqual(5)

      await act(async () => {
        jest.advanceTimersByTime(60_000)
        await Promise.resolve()
      })
      expect((apiCall as jest.Mock).mock.calls.length).toBe(callsAfterStop)

      unmount()
    } finally {
      jest.useRealTimers()
    }
  })

  it('refresh() restarts a stopped loop', async () => {
    ;(apiCall as jest.Mock).mockImplementation(async () => mockStatusResponse(500))

    jest.useFakeTimers()
    try {
      const { result, unmount } = renderHook(() =>
        useAiPendingActionPolling({ pendingActionId: 'pa-1', intervalMs: 1000 }),
      )

      for (let i = 0; i < 5; i += 1) {
        await act(async () => {
          jest.advanceTimersByTime(60_000)
          await Promise.resolve()
          await Promise.resolve()
        })
      }
      expect(result.current.isPolling).toBe(false)

      ;(apiCall as jest.Mock).mockImplementation(async () => ({
        ok: true,
        status: 200,
        result: { pendingAction: makeAction({ status: 'pending' }) },
        response: {},
        cacheStatus: null,
      }))

      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.action?.status).toBe('pending')
      expect(result.current.isPolling).toBe(true)

      const callsAfterRestart = (apiCall as jest.Mock).mock.calls.length
      await act(async () => {
        jest.advanceTimersByTime(1000)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect((apiCall as jest.Mock).mock.calls.length).toBeGreaterThan(callsAfterRestart)

      unmount()
    } finally {
      jest.useRealTimers()
    }
  })

  it('pauses polling while the tab is hidden and resumes on visibilitychange', async () => {
    mockOkResponse(makeAction({ status: 'pending' }))

    jest.useFakeTimers()
    try {
      const { unmount } = renderHook(() =>
        useAiPendingActionPolling({ pendingActionId: 'pa-1', intervalMs: 1000 }),
      )

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      const callsBeforeHidden = (apiCall as jest.Mock).mock.calls.length

      setDocumentVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))

      await act(async () => {
        jest.advanceTimersByTime(10_000)
        await Promise.resolve()
      })
      expect((apiCall as jest.Mock).mock.calls.length).toBe(callsBeforeHidden)

      setDocumentVisibility('visible')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await Promise.resolve()
        await Promise.resolve()
      })
      expect((apiCall as jest.Mock).mock.calls.length).toBeGreaterThan(callsBeforeHidden)

      unmount()
    } finally {
      jest.useRealTimers()
    }
  })
})
