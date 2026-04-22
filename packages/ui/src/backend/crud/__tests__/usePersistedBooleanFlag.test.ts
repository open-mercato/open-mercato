/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { usePersistedBooleanFlag } from '../usePersistedBooleanFlag'

describe('usePersistedBooleanFlag', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the default value when storage is empty', () => {
    const { result } = renderHook(() => usePersistedBooleanFlag('test:a', true))
    expect(result.current.value).toBe(true)
  })

  it('hydrates from localStorage on mount when a value is saved', () => {
    localStorage.setItem('test:b', JSON.stringify('1'))
    const { result } = renderHook(() => usePersistedBooleanFlag('test:b', false))
    expect(result.current.value).toBe(true)
  })

  it('hydrates "0" as false regardless of default', () => {
    localStorage.setItem('test:c', JSON.stringify('0'))
    const { result } = renderHook(() => usePersistedBooleanFlag('test:c', true))
    expect(result.current.value).toBe(false)
  })

  it('persists toggled value to localStorage', () => {
    const { result } = renderHook(() => usePersistedBooleanFlag('test:d', false))
    act(() => { result.current.toggle() })
    expect(result.current.value).toBe(true)
    expect(localStorage.getItem('test:d')).toBe(JSON.stringify('1'))
  })

  it('persists setValue writes', () => {
    const { result } = renderHook(() => usePersistedBooleanFlag('test:e', false))
    act(() => { result.current.setValue(true) })
    expect(localStorage.getItem('test:e')).toBe(JSON.stringify('1'))
    act(() => { result.current.setValue(false) })
    expect(localStorage.getItem('test:e')).toBe(JSON.stringify('0'))
  })

  it('writes initial value to storage on mount', () => {
    // React runs all effects on the same render cycle, so the "set mounted=true"
    // effect fires before the write effect checks mounted.current. The hook DOES
    // write the initial value on mount — this test locks in that observed behavior.
    renderHook(() => usePersistedBooleanFlag('test:f', true))
    expect(localStorage.getItem('test:f')).toBe(JSON.stringify('1'))
  })
})
