/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { APP_EVENT_DOM_NAME, BRIDGE_RECONNECTED_EVENT_ID } from '../useAppEvent'
import { useLiveRefetch } from '../useLiveRefetch'

function emit(id: string, payload: Record<string, unknown> = {}) {
  const detail = { id, payload } as AppEventPayload
  act(() => {
    window.dispatchEvent(new CustomEvent(APP_EVENT_DOM_NAME, { detail }))
  })
}

const isOrderOne = (event: AppEventPayload) => event.payload.id === 'order-1'

describe('useLiveRefetch', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('exports the wire value used by the backend bridge', () => {
    expect(BRIDGE_RECONNECTED_EVENT_ID).toBe('om:bridge:reconnected')
  })

  it('refetches without arguments on a matching event', () => {
    const refetch = jest.fn()
    renderHook(() => useLiveRefetch('sales.order.*', refetch))

    emit('sales.order.updated', { id: 'order-1' })

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(refetch).toHaveBeenCalledWith()
  })

  it('ignores events outside the pattern and events rejected by the filter', () => {
    const refetch = jest.fn()
    renderHook(() => useLiveRefetch('sales.order.*', refetch, { filter: isOrderOne }))

    emit('catalog.product.updated', { id: 'order-1' })
    emit('sales.order.updated', { id: 'order-2' })
    expect(refetch).not.toHaveBeenCalled()

    emit('sales.order.updated', { id: 'order-1' })
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('refetches on reconnect even when the filter would reject it', () => {
    const refetch = jest.fn()
    const filter = jest.fn(() => false)
    renderHook(() => useLiveRefetch('sales.order.*', refetch, { filter }))

    emit(BRIDGE_RECONNECTED_EVENT_ID)

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(filter).not.toHaveBeenCalled()
  })

  it('uses the latest refetch and filter without resubscribing', () => {
    const first = jest.fn()
    const second = jest.fn()
    const { rerender } = renderHook(
      ({ refetch, target }: { refetch: () => void; target: string }) =>
        useLiveRefetch('sales.order.*', refetch, { filter: (event) => event.payload.id === target }),
      { initialProps: { refetch: first, target: 'order-1' } },
    )

    rerender({ refetch: second, target: 'order-2' })
    emit('sales.order.updated', { id: 'order-1' })
    emit('sales.order.updated', { id: 'order-2' })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('coalesces a burst plus a reconnect into a leading and a trailing refetch', () => {
    jest.useFakeTimers()
    const refetch = jest.fn()
    renderHook(() => useLiveRefetch('sales.order.*', refetch, { filter: isOrderOne, coalesceMs: 500 }))

    emit('sales.order.updated', { id: 'order-1' })
    emit('sales.order.updated', { id: 'order-1' })
    emit('sales.order.updated', { id: 'order-2' })
    emit(BRIDGE_RECONNECTED_EVENT_ID)
    emit('sales.order.updated', { id: 'order-1' })
    expect(refetch).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(500)
    })
    expect(refetch).toHaveBeenCalledTimes(2)

    act(() => {
      jest.advanceTimersByTime(5000)
    })
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it('opens the coalescing window on a reconnect alone', () => {
    jest.useFakeTimers()
    const refetch = jest.fn()
    renderHook(() => useLiveRefetch('sales.order.*', refetch, { coalesceMs: 500 }))

    emit(BRIDGE_RECONNECTED_EVENT_ID)
    expect(refetch).toHaveBeenCalledTimes(1)
    emit('sales.order.updated')
    act(() => {
      jest.advanceTimersByTime(500)
    })
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it('removes its listeners and pending window on unmount', () => {
    jest.useFakeTimers()
    const refetch = jest.fn()
    const coalesced = jest.fn()
    const plain = renderHook(() => useLiveRefetch('sales.order.*', refetch))
    const windowed = renderHook(() => useLiveRefetch('sales.order.*', coalesced, { coalesceMs: 500 }))

    emit('sales.order.updated')
    emit('sales.order.updated')
    expect(coalesced).toHaveBeenCalledTimes(1)
    plain.unmount()
    windowed.unmount()
    refetch.mockClear()

    emit('sales.order.updated')
    emit(BRIDGE_RECONNECTED_EVENT_ID)
    act(() => {
      jest.advanceTimersByTime(5000)
    })

    expect(refetch).not.toHaveBeenCalled()
    expect(coalesced).toHaveBeenCalledTimes(1)
  })
})
