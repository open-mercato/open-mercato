/** @jest-environment jsdom */
import * as React from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePortalNotifications } from '../usePortalNotifications'
import {
  clearPortalBridgeHealth,
  publishPortalBridgeHealth,
} from '../portalBridgeStatus'

const apiCallMock = jest.fn()

jest.mock('../../../backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

describe('usePortalNotifications strategy', () => {
  const originalEventSource = globalThis.window?.EventSource
  let setIntervalSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { ok: true, items: [], unreadCount: 0 },
    })
    setIntervalSpy = jest.spyOn(global, 'setInterval')
    clearPortalBridgeHealth()
  })

  afterEach(() => {
    setIntervalSpy.mockRestore()
    if (typeof originalEventSource === 'undefined') {
      delete (window as unknown as { EventSource?: typeof EventSource }).EventSource
    } else {
      ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = originalEventSource
    }
  })

  it('keeps polling until an available EventSource bridge reports healthy', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(apiCallMock).toHaveBeenCalled()
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 8000)
  })

  it('uses SSE strategy without polling when the bridge is explicitly healthy', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource
    publishPortalBridgeHealth(true)

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(apiCallMock).toHaveBeenCalled()
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 8000)
  })

  it('falls back to polling strategy when EventSource is unavailable', async () => {
    delete (window as unknown as { EventSource?: typeof EventSource }).EventSource

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(apiCallMock).toHaveBeenCalled()
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 8000)
  })

  it('activates polling when SSE is explicitly marked unhealthy', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource

    publishPortalBridgeHealth(false)

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 8000)
  })

  it('switches to polling fallback dynamically when status becomes unhealthy', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource
    publishPortalBridgeHealth(true)

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(apiCallMock).toHaveBeenCalledTimes(2)

    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 8000)

    act(() => {
      publishPortalBridgeHealth(false)
    })

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 8000)
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(4))
  })

  it('performs one reconciliation for an unhealthy-to-reconnected sequence', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource
    publishPortalBridgeHealth(true)

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(apiCallMock).toHaveBeenCalledTimes(2)

    act(() => {
      publishPortalBridgeHealth(false)
    })
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(4))

    act(() => {
      publishPortalBridgeHealth(true)
      window.dispatchEvent(
        new CustomEvent('om:portal-event', {
          detail: {
            id: 'om:portal-bridge:reconnected',
            payload: {},
          },
        })
      )
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(6))
  })

  it('reconciles notifications when the portal window regains focus', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(apiCallMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(4))
  })
})
