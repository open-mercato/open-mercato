/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { isTimelineItemDraggable, mergeCollapsedLaneToggles, resolveTimelineCountCaps } from '../DealsTimelineBoard'
import {
  formatTimelineCount,
  formatTimelineDealCount,
  formatTimelineMoreLabel,
  formatTimelineUndatedLabel,
} from '../TimelineLane'
import {
  TIMELINE_BACK_NAVIGATION_TIMEOUT_MS,
  parseTimelineUrlState,
  resolveTimelineFrom,
  useTimelineUrlState,
} from '../useTimelineUrlState'
import { addBuckets } from '../../../../../../lib/dealsTimeline'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

const translate = (key: string, fallbackOrParams?: unknown, maybeParams?: Record<string, unknown>) => {
  const params = (typeof fallbackOrParams === 'object' ? fallbackOrParams : maybeParams) as Record<string, unknown> | undefined
  const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
  return fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
}
const t = translate as unknown as Parameters<typeof formatTimelineCount>[0]

const OPEN_ITEM = { id: 'deal-1', expectedCloseAt: '2026-11-04', status: 'open' }

describe('isTimelineItemDraggable', () => {
  const base = { canManage: true, locked: false, inFlightDealIds: new Set<string>() }

  it('allows an open, dated deal for a manager', () => {
    expect(isTimelineItemDraggable(OPEN_ITEM, base)).toBe(true)
  })

  it('blocks a second reschedule while the first one for the same deal is in flight', () => {
    expect(isTimelineItemDraggable(OPEN_ITEM, { ...base, inFlightDealIds: new Set(['deal-1']) })).toBe(false)
    expect(isTimelineItemDraggable({ ...OPEN_ITEM, id: 'deal-2' }, { ...base, inFlightDealIds: new Set(['deal-1']) })).toBe(true)
  })

  it('blocks drags while placeholder data from another bucket is shown', () => {
    expect(isTimelineItemDraggable(OPEN_ITEM, { ...base, locked: true })).toBe(false)
  })

  it('blocks read-only users, closed deals and undated deals', () => {
    expect(isTimelineItemDraggable(OPEN_ITEM, { ...base, canManage: false })).toBe(false)
    expect(isTimelineItemDraggable({ ...OPEN_ITEM, status: 'Won' }, base)).toBe(false)
    expect(isTimelineItemDraggable({ ...OPEN_ITEM, expectedCloseAt: null }, base)).toBe(false)
  })
})

describe('capped and partial count labels', () => {
  it('renders capped counts with a plus', () => {
    expect(formatTimelineCount(t, 10000, true)).toBe('10000+')
    expect(formatTimelineCount(t, 12, false)).toBe('12')
    expect(formatTimelineUndatedLabel(t, 'en', 10000, true)).toBe('10000+ deals have no close date')
    expect(formatTimelineUndatedLabel(t, 'en', 3)).toBe('3 deals have no close date')
    expect(formatTimelineDealCount(t, 'en', 10000, true)).toBe('10000+ deals')
  })

  it('never renders a double plus on a partial "+N more" button', () => {
    expect(formatTimelineMoreLabel(t, 5, false)).toBe('+5 more')
    expect(formatTimelineMoreLabel(t, 5, true)).toBe('5+ more')
  })
})

describe('useTimelineUrlState functional updates', () => {
  const replace = jest.fn()
  const push = jest.fn()
  const back = jest.fn()
  let currentParams = new URLSearchParams()

  beforeEach(() => {
    replace.mockReset()
    push.mockReset()
    back.mockReset()
    currentParams = new URLSearchParams()
    ;(usePathname as jest.Mock).mockReturnValue('/backend/customers/deals/timeline')
    ;(useRouter as jest.Mock).mockReturnValue({ replace, push, back })
    ;(useSearchParams as jest.Mock).mockImplementation(() => currentParams)
  })

  it('merges two filter edits made before the URL updates', () => {
    const { result } = renderHook(() => useTimelineUrlState())
    act(() => result.current.update((current) => ({ filters: { ...current.filters, status: ['open'] } })))
    act(() => result.current.update((current) => ({ filters: { ...current.filters, search: 'acme' } })))
    const href = replace.mock.calls[replace.mock.calls.length - 1][0] as string
    expect(href).toContain('status=open')
    expect(href).toContain('search=acme')
  })

  it('advances the window twice on two quick Next clicks', () => {
    currentParams = new URLSearchParams('from=2026-11-02')
    const { result } = renderHook(() => useTimelineUrlState())
    const next = () =>
      result.current.update((current) => ({
        from: addBuckets(resolveTimelineFrom(current, '2026-11-05'), current.bucket, 1),
      }))
    act(() => next())
    act(() => next())
    const href = replace.mock.calls[replace.mock.calls.length - 1][0] as string
    expect(href).toContain('from=2026-11-16')
  })

  it('defers updates made while a history back is pending until it lands', () => {
    currentParams = new URLSearchParams('bucket=month&deal=66666666-6666-4666-8666-666666666666')
    const { result, rerender } = renderHook(() => useTimelineUrlState())
    act(() => result.current.update({ dealId: null }, { history: 'back' }))
    expect(back).toHaveBeenCalledTimes(1)
    act(() => result.current.update({ groupBy: 'stage' }))
    expect(replace).not.toHaveBeenCalled()
    currentParams = new URLSearchParams('bucket=month')
    act(() => rerender())
    expect(replace).toHaveBeenCalledTimes(1)
    const href = replace.mock.calls[0][0] as string
    expect(href).toContain('groupBy=stage')
    expect(href).toContain('bucket=month')
    expect(href).not.toContain('deal=')
  })

  it('applies deferred updates after a timeout when the history back never lands', () => {
    jest.useFakeTimers()
    try {
      currentParams = new URLSearchParams('deal=66666666-6666-4666-8666-666666666666')
      const { result } = renderHook(() => useTimelineUrlState())
      act(() => result.current.update({ dealId: null }, { history: 'back' }))
      act(() => result.current.update({ bucket: 'quarter' }))
      expect(replace).not.toHaveBeenCalled()
      act(() => {
        jest.advanceTimersByTime(TIMELINE_BACK_NAVIGATION_TIMEOUT_MS)
      })
      expect(replace).toHaveBeenCalledTimes(1)
      const href = replace.mock.calls[0][0] as string
      expect(href).toContain('bucket=quarter')
      expect(href).not.toContain('deal=')
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not navigate again when the history back alone matches the pending state', () => {
    currentParams = new URLSearchParams('bucket=month&deal=66666666-6666-4666-8666-666666666666')
    const { result, rerender } = renderHook(() => useTimelineUrlState())
    act(() => result.current.update({ dealId: null }, { history: 'back' }))
    currentParams = new URLSearchParams('bucket=month')
    act(() => rerender())
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })
})

describe('URL id lists', () => {
  it('caps id lists parsed from the URL at the saved-view limit', () => {
    const ids = Array.from({ length: 150 }, (_value, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
    const state = parseTimelineUrlState(new URLSearchParams(`ownerUserId=${ids.join(',')}`))
    expect(state.filters.ownerUserId).toHaveLength(100)
  })

  it('caps the search length and drops oversized status values parsed from the URL', () => {
    const longStatus = 'x'.repeat(101)
    const state = parseTimelineUrlState(
      new URLSearchParams(`search=${'a'.repeat(250)}&status=open,${longStatus}`),
    )
    expect(state.filters.search).toHaveLength(200)
    expect(state.filters.status).toEqual(['open'])
  })
})

describe('resolveTimelineCountCaps', () => {
  it('keeps column totals exact when only the undated count is capped', () => {
    const caps = resolveTimelineCountCaps({
      columns: [
        { index: 0, from: '2026-11-02', to: '2026-11-09', isCurrent: true, total: 2, truncated: false, countCapped: false },
        { index: 1, from: '2026-11-09', to: '2026-11-16', isCurrent: false, total: 10000, truncated: true, countCapped: true },
      ],
      overdueBefore: { count: 3, latestExpectedCloseAt: '2026-10-01', before: '2026-11-02', countCapped: false },
      undatedCountCapped: true,
    })
    expect(caps.undated).toBe(true)
    expect(caps.overdue).toBe(false)
    expect(caps.columns.get(0)).toBe(false)
    expect(caps.columns.get(1)).toBe(true)
    expect(formatTimelineCount(t, 2, caps.columns.get(0) === true)).toBe('2')
  })
})

describe('mergeCollapsedLaneToggles', () => {
  it('applies toggles made before the storage key was known on top of the stored lanes', () => {
    expect(mergeCollapsedLaneToggles(['lane-a', 'lane-b'], ['lane-b', 'lane-c']).sort((left, right) => left.localeCompare(right))).toEqual([
      'lane-a',
      'lane-c',
    ])
    expect(mergeCollapsedLaneToggles(['lane-a'], [])).toEqual(['lane-a'])
  })
})
