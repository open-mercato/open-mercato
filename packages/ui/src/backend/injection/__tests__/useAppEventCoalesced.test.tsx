/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { APP_EVENT_DOM_NAME, useAppEvent } from '../useAppEvent'
import { DEFAULT_APP_EVENT_COALESCE_WINDOW_MS, useAppEventCoalesced } from '../useAppEventCoalesced'

const MESSAGE_LIST_KEY = ['messages', 'list']

function dispatchMessageEvents(count: number, gapMs = 5) {
  for (let i = 0; i < count; i++) {
    const detail: AppEventPayload = {
      id: 'messages.message.sent',
      payload: { messageId: `message-${i}` },
    } as AppEventPayload
    act(() => {
      window.dispatchEvent(new CustomEvent(APP_EVENT_DOM_NAME, { detail }))
      jest.advanceTimersByTime(gapMs)
    })
  }
}

describe('useAppEventCoalesced', () => {
  let invalidateQueries: jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    invalidateQueries = jest.fn()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const invalidateMessageList = () => {
    invalidateQueries({ queryKey: MESSAGE_LIST_KEY })
  }

  it('characterizes the un-coalesced hook: one invalidation per ingested message', () => {
    renderHook(() => useAppEvent('messages.message.*', invalidateMessageList, []))

    dispatchMessageEvents(50)

    expect(invalidateQueries).toHaveBeenCalledTimes(50)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: MESSAGE_LIST_KEY })
  })

  it('collapses an ingest burst into a leading and a trailing invalidation', () => {
    renderHook(() => useAppEventCoalesced('messages.message.*', invalidateMessageList, []))

    dispatchMessageEvents(50)
    expect(invalidateQueries).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(DEFAULT_APP_EVENT_COALESCE_WINDOW_MS)
    })

    expect(invalidateQueries).toHaveBeenCalledTimes(2)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: MESSAGE_LIST_KEY })
  })

  it('runs the trailing invalidation even when the burst ends mid-window', () => {
    const handler = jest.fn()
    renderHook(() => useAppEventCoalesced('messages.message.*', handler, []))

    dispatchMessageEvents(3)
    expect(handler).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(DEFAULT_APP_EVENT_COALESCE_WINDOW_MS)
    })

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[1][0]).toMatchObject({ payload: { messageId: 'message-2' } })
  })

  it('invalidates once and immediately for a single event', () => {
    renderHook(() => useAppEventCoalesced('messages.message.*', invalidateMessageList, []))

    dispatchMessageEvents(1)
    expect(invalidateQueries).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(DEFAULT_APP_EVENT_COALESCE_WINDOW_MS * 5)
    })

    expect(invalidateQueries).toHaveBeenCalledTimes(1)
  })

  it('keeps slow traffic at one invalidation per event', () => {
    renderHook(() => useAppEventCoalesced('messages.message.*', invalidateMessageList, []))

    for (let i = 0; i < 4; i++) {
      dispatchMessageEvents(1)
      act(() => {
        jest.advanceTimersByTime(DEFAULT_APP_EVENT_COALESCE_WINDOW_MS * 2)
      })
    }

    expect(invalidateQueries).toHaveBeenCalledTimes(4)
  })

  it('does not invalidate after unmount mid-window', () => {
    const { unmount } = renderHook(() =>
      useAppEventCoalesced('messages.message.*', invalidateMessageList, []),
    )

    dispatchMessageEvents(10)
    expect(invalidateQueries).toHaveBeenCalledTimes(1)

    unmount()

    act(() => {
      jest.advanceTimersByTime(DEFAULT_APP_EVENT_COALESCE_WINDOW_MS * 5)
    })
    dispatchMessageEvents(5)

    expect(invalidateQueries).toHaveBeenCalledTimes(1)
  })

  it('ignores events that do not match the pattern', () => {
    renderHook(() => useAppEventCoalesced('messages.message.*', invalidateMessageList, []))

    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_EVENT_DOM_NAME, { detail: { id: 'sales.order.created' } }),
      )
      jest.advanceTimersByTime(DEFAULT_APP_EVENT_COALESCE_WINDOW_MS * 2)
    })

    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('fires immediately for a fresh event shortly after a multi-event burst settles', () => {
    renderHook(() => useAppEventCoalesced('messages.message.*', invalidateMessageList, []))

    dispatchMessageEvents(2)
    expect(invalidateQueries).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(DEFAULT_APP_EVENT_COALESCE_WINDOW_MS)
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(2)

    act(() => {
      jest.advanceTimersByTime(100)
    })
    dispatchMessageEvents(1)

    expect(invalidateQueries).toHaveBeenCalledTimes(3)
  })

  it('honours a custom window', () => {
    renderHook(() =>
      useAppEventCoalesced('messages.message.*', invalidateMessageList, [], { windowMs: 200 }),
    )

    dispatchMessageEvents(10, 1)
    expect(invalidateQueries).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(200)
    })

    expect(invalidateQueries).toHaveBeenCalledTimes(2)
  })
})
