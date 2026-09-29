/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { useCoalescedReload } from '../components/useCoalescedReload'

describe('useCoalescedReload', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('coalesces a burst into one leading and one trailing execution', () => {
    const reload = jest.fn()
    const { result } = renderHook(() => useCoalescedReload(reload))

    act(() => {
      for (let call = 0; call < 10; call += 1) result.current()
    })
    expect(reload).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(5000)
    })
    expect(reload).toHaveBeenCalledTimes(2)

    act(() => {
      jest.advanceTimersByTime(60000)
    })
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('passes spaced calls straight through on the leading edge', () => {
    const reload = jest.fn()
    const { result } = renderHook(() => useCoalescedReload(reload, { minIntervalMs: 1000 }))

    act(() => {
      result.current()
    })
    expect(reload).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(1500)
    })
    act(() => {
      result.current()
    })
    expect(reload).toHaveBeenCalledTimes(2)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('schedules the trailing run at cooldown end, not per call', () => {
    const reload = jest.fn()
    const { result } = renderHook(() => useCoalescedReload(reload, { minIntervalMs: 4000 }))

    act(() => {
      result.current()
    })
    act(() => {
      jest.advanceTimersByTime(3000)
    })
    act(() => {
      result.current()
      result.current()
    })
    expect(reload).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('clears the pending trailing run on unmount', () => {
    const reload = jest.fn()
    const { result, unmount } = renderHook(() => useCoalescedReload(reload))

    act(() => {
      result.current()
      result.current()
    })
    expect(reload).toHaveBeenCalledTimes(1)

    unmount()
    act(() => {
      jest.advanceTimersByTime(10000)
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
