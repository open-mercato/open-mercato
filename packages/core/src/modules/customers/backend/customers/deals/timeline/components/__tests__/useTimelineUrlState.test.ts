import {
  applyClosedToggle,
  applyStatusSelection,
  buildTimelineHref,
  buildTimelineSearchParams,
  emptyTimelineFilters,
  hasActiveTimelineFilters,
  normalizeTimelineFilters,
  parseTimelineUrlState,
  resolveTimelineFrom,
  type TimelineUrlState,
} from '../useTimelineUrlState'
import { buildTimelineApiParams } from '../DealsTimelineBoard'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

const OWNER = '11111111-1111-4111-8111-111111111111'

describe('timeline URL state', () => {
  it('parses defaults from an empty URL', () => {
    const state = parseTimelineUrlState(new URLSearchParams())
    expect(state).toEqual({
      bucket: 'week',
      groupBy: 'owner',
      from: null,
      dealId: null,
      filters: emptyTimelineFilters(),
    })
    expect(resolveTimelineFrom(state, '2026-11-05')).toBe('2026-10-26')
  })

  it('round-trips every parameter and aligns `from` to its bucket', () => {
    const params = new URLSearchParams(
      `bucket=month&groupBy=stage&from=2026-11-17&search=lims&status=open,in_progress&pipelineId=p1&ownerUserId=${OWNER}&personId=a&personId=b&companyId=c&closed=all&deal=d1`,
    )
    const state = parseTimelineUrlState(params)
    expect(state.bucket).toBe('month')
    expect(state.groupBy).toBe('stage')
    expect(state.from).toBe('2026-11-01')
    expect(state.dealId).toBe('d1')
    expect(state.filters).toEqual({
      search: 'lims',
      status: ['open', 'in_progress'],
      pipelineId: 'p1',
      ownerUserId: [OWNER],
      personId: ['a', 'b'],
      companyId: ['c'],
      excludeClosed: false,
    })
    expect(parseTimelineUrlState(buildTimelineSearchParams(state))).toEqual(state)
  })

  it('ignores invalid bucket, grouping and dates', () => {
    const state = parseTimelineUrlState(new URLSearchParams('bucket=day&groupBy=team&from=2026-13-01'))
    expect(state.bucket).toBe('week')
    expect(state.groupBy).toBe('owner')
    expect(state.from).toBeNull()
  })

  it('drops closed statuses from a URL that also hides closed deals', () => {
    const state = parseTimelineUrlState(new URLSearchParams('status=open,win,loose'))
    expect(state.filters.excludeClosed).toBe(true)
    expect(state.filters.status).toEqual(['open'])
  })

  it('builds a minimal href for the default state', () => {
    const state = parseTimelineUrlState(new URLSearchParams())
    expect(buildTimelineHref(state)).toBe('/backend/customers/deals/timeline')
  })
})

describe('closed-deals toggle and Status filter', () => {
  const base = emptyTimelineFilters()

  it('switches to All deals when a closed status is chosen', () => {
    const next = applyStatusSelection(base, ['open', 'win'])
    expect(next.excludeClosed).toBe(false)
    expect(next.status).toEqual(['open', 'win'])
  })

  it('keeps the toggle where it was when only open statuses are chosen', () => {
    expect(applyStatusSelection(base, ['open']).excludeClosed).toBe(true)
    expect(applyStatusSelection({ ...base, excludeClosed: false }, ['open']).excludeClosed).toBe(false)
  })

  it('removes closed statuses when switching back to Hide closed deals', () => {
    const allDeals = applyStatusSelection(base, ['open', 'won', 'lost'])
    const hidden = applyClosedToggle(allDeals, true)
    expect(hidden).toEqual({ ...allDeals, excludeClosed: true, status: ['open'] })
    expect(applyClosedToggle(hidden, false).status).toEqual(['open'])
  })

  it('normalizes a saved combination of Hide closed deals and a closed status', () => {
    expect(normalizeTimelineFilters({ ...base, status: ['WIN', 'open'] }).status).toEqual(['open'])
  })

  it('treats Clear filters as the default state', () => {
    expect(hasActiveTimelineFilters(emptyTimelineFilters())).toBe(false)
    expect(hasActiveTimelineFilters({ ...base, excludeClosed: false })).toBe(true)
    expect(hasActiveTimelineFilters({ ...base, search: 'x' })).toBe(true)
  })
})

describe('timeline API params', () => {
  const state: TimelineUrlState = {
    bucket: 'quarter',
    groupBy: 'owner',
    from: null,
    dealId: 'ignored',
    filters: { ...emptyTimelineFilters(), status: ['open'], ownerUserId: [OWNER] },
  }

  it('sends the resolved window, filters and the explicit excludeClosed flag', () => {
    const params = buildTimelineApiParams(state, '2026-11-05')
    expect(params.get('bucket')).toBe('quarter')
    expect(params.get('from')).toBe('2026-10-01')
    expect(params.get('columns')).toBe('4')
    expect(params.get('perCell')).toBe('3')
    expect(params.getAll('status')).toEqual(['open'])
    expect(params.getAll('ownerUserId')).toEqual([OWNER])
    expect(params.get('excludeClosed')).toBe('true')
    expect(params.has('deal')).toBe(false)
  })

  it('keeps the filters when Today resets the window', () => {
    const moved = { ...state, from: '2027-04-01' }
    const today = { ...moved, from: null }
    expect(buildTimelineApiParams(today, '2026-11-05').getAll('status')).toEqual(['open'])
    expect(buildTimelineApiParams(today, '2026-11-05').get('from')).toBe('2026-10-01')
  })
})
