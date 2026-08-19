/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useEventBridge } from '../eventBridge'
import { usePortalEventBridge } from '../../../portal/hooks/usePortalEventBridge'

type EventSourceCallback = EventListenerOrEventListenerObject

class MockEventSource {
  static instances: MockEventSource[] = []

  readonly close = jest.fn()
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private readonly listeners = new Map<string, Set<EventSourceCallback>>()

  constructor() {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, callback: EventSourceCallback | null): void {
    if (!callback) return
    const callbacks = this.listeners.get(type) ?? new Set<EventSourceCallback>()
    callbacks.add(callback)
    this.listeners.set(type, callbacks)
  }

  emitOpen(): void {
    this.onopen?.(new Event('open'))
  }

  emitHeartbeat(): void {
    const event = new MessageEvent('heartbeat', { data: '{}' })
    for (const callback of this.listeners.get('heartbeat') ?? []) {
      if (typeof callback === 'function') callback(event)
      else callback.handleEvent(event)
    }
  }
}

describe.each([
  ['staff', useEventBridge],
  ['portal', usePortalEventBridge],
] as const)('%s EventBridge heartbeat watchdog', (_surface, useBridge) => {
  const originalEventSource = globalThis.EventSource

  beforeEach(() => {
    jest.useFakeTimers()
    MockEventSource.instances = []
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      writable: true,
      value: MockEventSource as unknown as typeof EventSource,
    })
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      writable: true,
      value: originalEventSource,
    })
  })

  it('keeps the connection alive when a named heartbeat arrives before the timeout', () => {
    const { unmount } = renderHook(() => useBridge())
    const source = MockEventSource.instances[0]

    act(() => source.emitOpen())
    act(() => jest.advanceTimersByTime(30_000))
    act(() => source.emitHeartbeat())
    act(() => jest.advanceTimersByTime(16_000))

    expect(source.close).not.toHaveBeenCalled()
    expect(MockEventSource.instances).toHaveLength(1)

    unmount()
  })
})
