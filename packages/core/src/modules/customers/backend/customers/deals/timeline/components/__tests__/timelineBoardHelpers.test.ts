/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { isTimelineItemDraggable } from '../DealsTimelineBoard'
import {
  formatTimelineCount,
  formatTimelineDealCount,
  formatTimelineMoreLabel,
  formatTimelineUndatedLabel,
} from '../TimelineLane'
import { useTimelineUrlState } from '../useTimelineUrlState'

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
  let currentParams = new URLSearchParams()

  beforeEach(() => {
    replace.mockReset()
    currentParams = new URLSearchParams()
    ;(usePathname as jest.Mock).mockReturnValue('/backend/customers/deals/timeline')
    ;(useRouter as jest.Mock).mockReturnValue({ replace, push: jest.fn() })
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
})
