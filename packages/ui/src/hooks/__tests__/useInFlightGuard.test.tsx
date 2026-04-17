/** @jest-environment jsdom */
import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useInFlightGuard } from '../useInFlightGuard'

describe('useInFlightGuard', () => {
  it('rejects concurrent calls until the first operation resolves', async () => {
    const operation = jest.fn(() => new Promise<string>((resolve) => {
      setTimeout(() => resolve('ok'), 30)
    }))

    const { result } = renderHook(() => useInFlightGuard())

    await act(async () => {
      const first = result.current.run(operation)
      const second = result.current.run(operation)
      const third = result.current.run(operation)
      expect(await first).toBe('ok')
      expect(await second).toBeUndefined()
      expect(await third).toBeUndefined()
    })

    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('allows a new call once the previous operation resolves', async () => {
    const operation = jest.fn(() => Promise.resolve('done'))
    const { result } = renderHook(() => useInFlightGuard())

    await act(async () => {
      await result.current.run(operation)
    })
    await act(async () => {
      await result.current.run(operation)
    })
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('releases the guard when the operation rejects', async () => {
    const failing = jest.fn(() => Promise.reject(new Error('boom')))
    const succeeding = jest.fn(() => Promise.resolve('ok'))

    const { result } = renderHook(() => useInFlightGuard())

    await act(async () => {
      await expect(result.current.run(failing)).rejects.toThrow('boom')
    })

    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })

    await act(async () => {
      await result.current.run(succeeding)
    })
    expect(succeeding).toHaveBeenCalledTimes(1)
  })

  it('invokes onDuplicate when a concurrent call is rejected', async () => {
    const onDuplicate = jest.fn()
    const slow = jest.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

    const { result } = renderHook(() => useInFlightGuard({ onDuplicate }))

    await act(async () => {
      const first = result.current.run(slow)
      result.current.run(slow)
      result.current.run(slow)
      await first
    })

    expect(slow).toHaveBeenCalledTimes(1)
    expect(onDuplicate).toHaveBeenCalledTimes(2)
  })

  it('exposes a guard() wrapper preserving arguments', async () => {
    const handler = jest.fn(async (x: number, y: number) => x + y)
    const { result } = renderHook(() => useInFlightGuard())

    let res: number | undefined
    await act(async () => {
      const guarded = result.current.guard(handler)
      res = await guarded(2, 3)
    })
    expect(res).toBe(5)
    expect(handler).toHaveBeenCalledWith(2, 3)
  })
})
