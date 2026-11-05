/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useZoneCollapse } from '../useZoneCollapse'

describe('useZoneCollapse', () => {
  beforeEach(() => { localStorage.clear() })

  it('defaults to collapsed=false', () => {
    const { result } = renderHook(() => useZoneCollapse('person'))
    expect(result.current.collapsed).toBe(false)
  })

  it('writes to om:zone1-collapsed:<pageType> on toggle', () => {
    const { result } = renderHook(() => useZoneCollapse('deal'))
    act(() => { result.current.toggle() })
    expect(result.current.collapsed).toBe(true)
    expect(localStorage.getItem('om:zone1-collapsed:deal')).toBe(JSON.stringify('1'))
  })

  it('hydrates collapsed=true from storage on mount', () => {
    localStorage.setItem('om:zone1-collapsed:company', JSON.stringify('1'))
    const { result } = renderHook(() => useZoneCollapse('company'))
    expect(result.current.collapsed).toBe(true)
  })

  it('accepts functional setCollapsed', () => {
    const { result } = renderHook(() => useZoneCollapse('person'))
    act(() => { result.current.setCollapsed((prev) => !prev) })
    expect(result.current.collapsed).toBe(true)
  })
})
