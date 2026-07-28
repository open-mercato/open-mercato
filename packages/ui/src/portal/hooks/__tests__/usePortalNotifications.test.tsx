/** @jest-environment jsdom */
import * as React from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePortalNotifications } from '../usePortalNotifications'

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
    // Reset window flags
    delete (window as any).__portalBridgeHealthy
  })

  afterEach(() => {
    setIntervalSpy.mockRestore()
    if (typeof originalEventSource === 'undefined') {
      delete (window as unknown as { EventSource?: typeof EventSource }).EventSource
    } else {
      ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = originalEventSource
    }
  })

  it('uses SSE strategy without installing the polling interval when EventSource is available', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Initial load happens, but no setInterval for polling
    expect(apiCallMock).toHaveBeenCalled()
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 8000)
  })

  it('falls back to polling strategy when EventSource is unavailable', async () => {
    delete (window as unknown as { EventSource?: typeof EventSource }).EventSource

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Initial load + polling interval installed
    expect(apiCallMock).toHaveBeenCalled()
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 8000)
  })

  it('activates polling when SSE is explicitly marked unhealthy', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource

    // Explicitly unhealthy
    (window as any).__portalBridgeHealthy = false

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 8000)
  })

  it('switches to polling fallback dynamically when status becomes unhealthy', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 8000)

    // Dispatch unhealthy status
    act(() => {
      window.dispatchEvent(
        new CustomEvent('om:portal-bridge:status', { detail: { healthy: false } })
      )
    })

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 8000)
  })

  it('triggers refetch on portal bridge reconnect event', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource

    const { result } = renderHook(() => usePortalNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(apiCallMock).toHaveBeenCalledTimes(2) // list and count initially

    act(() => {
      window.dispatchEvent(
        new CustomEvent('om:portal-event', {
          detail: {
            id: 'om:portal-bridge:reconnected',
            payload: {},
          },
        })
      )
    })

    // apiCall called again (2 more times for list and count)
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(4))
  })
})
