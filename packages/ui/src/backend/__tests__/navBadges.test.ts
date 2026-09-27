import { renderHook, act } from '@testing-library/react'
import { setNavBadge, clearNavBadge, useNavBadge } from '../nav/navBadges'

const HREF = '/backend/caseload'
const OTHER = '/backend/traces'

// The store is a module singleton; every case starts from an empty slot.
afterEach(() => {
  clearNavBadge(HREF)
  clearNavBadge(OTHER)
})

describe('nav badges', () => {
  it('publishes a count to subscribers of that href only', () => {
    const target = renderHook(() => useNavBadge(HREF))
    const bystander = renderHook(() => useNavBadge(OTHER))

    act(() => setNavBadge(HREF, { count: 3, tone: 'attention' }))

    expect(target.result.current).toEqual({ count: 3, tone: 'attention' })
    expect(bystander.result.current).toBeNull()
  })

  it('renders nothing for a zero count rather than an empty chip', () => {
    const { result } = renderHook(() => useNavBadge(HREF))

    act(() => setNavBadge(HREF, { count: 4 }))
    expect(result.current?.count).toBe(4)

    act(() => setNavBadge(HREF, { count: 0 }))
    expect(result.current).toBeNull()
  })

  it('clears the slot when the count becomes unknown', () => {
    const { result } = renderHook(() => useNavBadge(HREF))

    act(() => setNavBadge(HREF, { count: 2 }))
    act(() => clearNavBadge(HREF))

    expect(result.current).toBeNull()
  })

  it('ignores a non-finite count instead of rendering NaN', () => {
    const { result } = renderHook(() => useNavBadge(HREF))

    act(() => setNavBadge(HREF, { count: 5 }))
    act(() => setNavBadge(HREF, { count: Number.NaN }))

    expect(result.current).toBeNull()
  })

  it('ignores an empty href', () => {
    const { result } = renderHook(() => useNavBadge(''))
    act(() => setNavBadge('', { count: 7 }))
    expect(result.current).toBeNull()
  })
})
