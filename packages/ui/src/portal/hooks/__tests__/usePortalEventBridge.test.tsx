/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { usePortalEventBridge } from '../usePortalEventBridge'
import {
  clearPortalBridgeHealth,
  PORTAL_BRIDGE_STATUS_DOM_NAME,
  readPortalBridgeHealth,
  type PortalBridgeStatusDetail,
} from '../portalBridgeStatus'

class EventSourceMock {
  static instances: EventSourceMock[] = []

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  addEventListener = jest.fn()
  close = jest.fn()

  constructor() {
    EventSourceMock.instances.push(this)
  }
}

describe('usePortalEventBridge health lifecycle', () => {
  const originalEventSource = globalThis.window?.EventSource

  beforeEach(() => {
    jest.clearAllMocks()
    EventSourceMock.instances = []
    clearPortalBridgeHealth()
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = EventSourceMock as unknown as typeof EventSource
  })

  afterEach(() => {
    clearPortalBridgeHealth()
    if (typeof originalEventSource === 'undefined') {
      delete (window as unknown as { EventSource?: typeof EventSource }).EventSource
    } else {
      ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = originalEventSource
    }
  })

  it('publishes healthy on open and unhealthy when the bridge unmounts', () => {
    const statuses: boolean[] = []
    const handleStatus = (event: Event) => {
      statuses.push((event as CustomEvent<PortalBridgeStatusDetail>).detail.healthy)
    }
    window.addEventListener(PORTAL_BRIDGE_STATUS_DOM_NAME, handleStatus)

    const { unmount } = renderHook(() => usePortalEventBridge())
    const source = EventSourceMock.instances[0]
    expect(source).toBeDefined()

    act(() => {
      source.onopen?.(new Event('open'))
    })
    expect(readPortalBridgeHealth()).toBe(true)

    unmount()

    expect(source.close).toHaveBeenCalledTimes(1)
    expect(readPortalBridgeHealth()).toBe(false)
    expect(statuses).toEqual([true, false])
    window.removeEventListener(PORTAL_BRIDGE_STATUS_DOM_NAME, handleStatus)
  })
})
