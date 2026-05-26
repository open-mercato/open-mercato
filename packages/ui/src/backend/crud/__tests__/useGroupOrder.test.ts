/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useGroupOrder } from '../useGroupOrder'

describe('useGroupOrder', () => {
  beforeEach(() => { localStorage.clear() })

  it('returns defaults when storage is empty', () => {
    const defaults = ['a', 'b', 'c']
    const { result } = renderHook(() => useGroupOrder('people', defaults))
    expect(result.current.orderedIds).toEqual(defaults)
  })

  it('hydrates saved order from om:group-order:<pageType>', () => {
    localStorage.setItem('om:group-order:people', JSON.stringify(['c', 'a', 'b']))
    const { result } = renderHook(() => useGroupOrder('people', ['a', 'b', 'c']))
    expect(result.current.orderedIds).toEqual(['c', 'a', 'b'])
  })

  it('filters out stale IDs no longer in defaults and appends new IDs', () => {
    localStorage.setItem('om:group-order:people', JSON.stringify(['x', 'a', 'y', 'b']))
    const { result } = renderHook(() => useGroupOrder('people', ['a', 'b', 'c']))
    expect(result.current.orderedIds).toEqual(['a', 'b', 'c'])
  })

  it('reorder() moves items and persists the result', () => {
    const { result } = renderHook(() => useGroupOrder('people', ['a', 'b', 'c']))
    act(() => { result.current.reorder(0, 2) })
    expect(result.current.orderedIds).toEqual(['b', 'c', 'a'])
    expect(JSON.parse(localStorage.getItem('om:group-order:people')!)).toEqual(['b', 'c', 'a'])
  })

  it('reorder() handles insertion in the middle', () => {
    const { result } = renderHook(() => useGroupOrder('p', ['a', 'b', 'c', 'd']))
    act(() => { result.current.reorder(3, 1) })
    expect(result.current.orderedIds).toEqual(['a', 'd', 'b', 'c'])
  })

  it('updates ordering when defaults change to include a new id', () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useGroupOrder('p', ids),
      { initialProps: { ids: ['a', 'b'] } },
    )
    rerender({ ids: ['a', 'b', 'c'] })
    expect(result.current.orderedIds).toEqual(['a', 'b', 'c'])
  })

  it('removes ids from state when they disappear from defaults', () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useGroupOrder('p', ids),
      { initialProps: { ids: ['a', 'b', 'c'] } },
    )
    rerender({ ids: ['a', 'c'] })
    expect(result.current.orderedIds).toEqual(['a', 'c'])
  })

  it('does not rewrite storage on initial mount', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem')
    renderHook(() => useGroupOrder('p', ['a', 'b']))
    expect(spy).not.toHaveBeenCalledWith('om:group-order:p', expect.anything())
    spy.mockRestore()
  })
})
