/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { buildUrlWithSearch, useUrlSearchState } from '../useUrlSearchState'

const replaceMock = jest.fn()
let activePathname = '/backend/things'
let activeQuery = ''

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: jest.fn() }),
  usePathname: () => activePathname,
  useSearchParams: () => new URLSearchParams(activeQuery),
}))

describe('useUrlSearchState', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    activePathname = '/backend/things'
    activeQuery = ''
  })

  it('seeds the initial state from ?search without navigating on mount', () => {
    activeQuery = 'search=%20Harborview%20&page=2'
    const { result } = renderHook(() => useUrlSearchState())
    expect(result.current[0]).toBe('Harborview')
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('starts empty and stays quiet when the URL has no search', () => {
    const { result } = renderHook(() => useUrlSearchState())
    expect(result.current[0]).toBe('')
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('writes the trimmed search to the URL with replace and preserves other params', () => {
    activeQuery = 'tab=active&page=3'
    const { result } = renderHook(() => useUrlSearchState())
    act(() => { result.current[1](' acme ') })
    expect(result.current[0]).toBe(' acme ')
    expect(replaceMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).toHaveBeenCalledWith('/backend/things?tab=active&page=3&search=acme', { scroll: false })
  })

  it('removes the search param when the search is cleared', () => {
    activeQuery = 'search=acme&tab=active'
    const { result } = renderHook(() => useUrlSearchState())
    act(() => { result.current[1]('') })
    expect(replaceMock).toHaveBeenCalledWith('/backend/things?tab=active', { scroll: false })
  })

  it('drops the query string entirely when search was the only param', () => {
    activeQuery = 'search=acme'
    const { result } = renderHook(() => useUrlSearchState())
    act(() => { result.current[1]('   ') })
    expect(replaceMock).toHaveBeenCalledWith('/backend/things', { scroll: false })
  })

  it('does not navigate again when the URL catches up with the written value', () => {
    const { result, rerender } = renderHook(() => useUrlSearchState())
    act(() => { result.current[1]('acme') })
    expect(replaceMock).toHaveBeenCalledTimes(1)
    activeQuery = 'search=acme'
    rerender()
    rerender()
    expect(result.current[0]).toBe('acme')
    expect(replaceMock).toHaveBeenCalledTimes(1)
  })

  it('does not navigate for whitespace-only edits that normalize to the synced value', () => {
    activeQuery = 'search=acme'
    const { result } = renderHook(() => useUrlSearchState())
    act(() => { result.current[1]('acme  ') })
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('adopts external URL changes (back/forward, links) without writing them back', () => {
    activeQuery = 'search=acme'
    const { result, rerender } = renderHook(() => useUrlSearchState())
    activeQuery = 'search=globex'
    rerender()
    expect(result.current[0]).toBe('globex')
    activeQuery = ''
    rerender()
    expect(result.current[0]).toBe('')
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('supports a custom param name and updater functions', () => {
    activeQuery = 'q=foo&search=untouched'
    const { result } = renderHook(() => useUrlSearchState({ paramName: 'q' }))
    expect(result.current[0]).toBe('foo')
    act(() => { result.current[1]((previous) => `${previous}bar`) })
    expect(replaceMock).toHaveBeenCalledWith('/backend/things?q=foobar&search=untouched', { scroll: false })
  })
})

describe('buildUrlWithSearch', () => {
  it('encodes values and keeps unrelated params', () => {
    expect(buildUrlWithSearch('/backend/x', 'a=1', 'foo bar&baz')).toBe('/backend/x?a=1&search=foo+bar%26baz')
    expect(buildUrlWithSearch('/backend/x', 'search=old', '')).toBe('/backend/x')
  })
})
