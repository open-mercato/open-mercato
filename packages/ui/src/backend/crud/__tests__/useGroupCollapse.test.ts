/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useGroupCollapse } from '../useGroupCollapse'

describe('useGroupCollapse', () => {
  beforeEach(() => { localStorage.clear() })

  it('defaults to expanded=true', () => {
    const { result } = renderHook(() => useGroupCollapse('page', 'grp1'))
    expect(result.current.expanded).toBe(true)
  })

  it('honors explicit defaultExpanded=false', () => {
    const { result } = renderHook(() => useGroupCollapse('page', 'grp2', false))
    expect(result.current.expanded).toBe(false)
  })

  it('writes collapsed state to om:collapsible:<page>:<group>', () => {
    const { result } = renderHook(() => useGroupCollapse('people', 'basics'))
    act(() => { result.current.toggle() })
    expect(result.current.expanded).toBe(false)
    expect(localStorage.getItem('om:collapsible:people:basics')).toBe(JSON.stringify('0'))
  })

  it('accepts functional setExpanded', () => {
    const { result } = renderHook(() => useGroupCollapse('page', 'grp3'))
    act(() => { result.current.setExpanded((prev) => !prev) })
    expect(result.current.expanded).toBe(false)
  })

  it('scopes state per (pageType, groupId) pair', () => {
    localStorage.setItem('om:collapsible:p1:g', JSON.stringify('0'))
    const { result: a } = renderHook(() => useGroupCollapse('p1', 'g'))
    const { result: b } = renderHook(() => useGroupCollapse('p2', 'g'))
    expect(a.current.expanded).toBe(false)
    expect(b.current.expanded).toBe(true)
  })
})
