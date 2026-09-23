/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useEventBridge } from '../eventBridge'

class EventSourceMock {
  static instances: EventSourceMock[] = []

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  close = jest.fn()

  constructor() {
    EventSourceMock.instances.push(this)
  }
}

describe('useEventBridge connection lifecycle', () => {
  const originalEventSource = globalThis.window?.EventSource
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  let visibilityState: DocumentVisibilityState

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    EventSourceMock.instances = []
    visibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = EventSourceMock as unknown as typeof EventSource
  })

  afterEach(() => {
    jest.useRealTimers()
    if (originalVisibilityState) Object.defineProperty(document, 'visibilityState', originalVisibilityState)
    if (typeof originalEventSource === 'undefined') {
      delete (window as unknown as { EventSource?: typeof EventSource }).EventSource
    } else {
      ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = originalEventSource
    }
  })

  it('keeps a healthy connection alive when heartbeat messages arrive', () => {
    const { unmount } = renderHook(() => useEventBridge())
    const source = EventSourceMock.instances[0]

    act(() => source.onopen?.(new Event('open')))
    act(() => {
      jest.advanceTimersByTime(30_000)
      source.onmessage?.(new MessageEvent('message', { data: ':heartbeat' }))
      jest.advanceTimersByTime(44_999)
    })

    expect(source.close).not.toHaveBeenCalled()
    expect(EventSourceMock.instances).toHaveLength(1)
    unmount()
  })

  it('releases the connection while hidden and reconnects when visible', () => {
    const { unmount } = renderHook(() => useEventBridge())
    const source = EventSourceMock.instances[0]
    act(() => source.onopen?.(new Event('open')))

    act(() => {
      visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(source.close).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(EventSourceMock.instances).toHaveLength(1)

    act(() => {
      visibilityState = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(EventSourceMock.instances).toHaveLength(2)
    unmount()
  })
})
