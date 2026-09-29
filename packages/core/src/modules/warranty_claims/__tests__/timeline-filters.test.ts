import {
  TIMELINE_FILTERS,
  filterTimelineEvents,
  isTimelineFilterId,
  type TimelineFilterId,
  type TimelineFilterableEvent,
} from '../lib/timelineFilters'

type TestEvent = TimelineFilterableEvent & { id: string }

const events: TestEvent[] = [
  { id: 'comment-internal', kind: 'comment', visibility: 'internal' },
  { id: 'comment-customer', kind: 'comment', visibility: 'customer' },
  { id: 'status-change', kind: 'status_changed', visibility: 'internal' },
  { id: 'assignment', kind: 'assignment', visibility: 'internal' },
  { id: 'system-customer', kind: 'system', visibility: 'customer' },
  { id: 'unknown-kind', kind: 'mystery_kind', visibility: 'internal' },
]

function idsFor(filter: TimelineFilterId): string[] {
  return filterTimelineEvents(events, filter).map((event) => event.id)
}

describe('filterTimelineEvents', () => {
  it('returns every event unchanged for the all filter, including unknown kinds', () => {
    expect(filterTimelineEvents(events, 'all')).toEqual(events)
    expect(idsFor('all')).toContain('unknown-kind')
  })

  it('keeps only comment events for the comments filter', () => {
    expect(idsFor('comments')).toEqual(['comment-internal', 'comment-customer'])
  })

  it('keeps only status_changed events for the status_changes filter', () => {
    expect(idsFor('status_changes')).toEqual(['status-change'])
  })

  it('keeps only customer-visible events for the customer_visible filter, regardless of kind', () => {
    expect(idsFor('customer_visible')).toEqual(['comment-customer', 'system-customer'])
  })

  it('excludes unknown-kind events from kind-specific filters', () => {
    expect(idsFor('comments')).not.toContain('unknown-kind')
    expect(idsFor('status_changes')).not.toContain('unknown-kind')
  })

  it('returns an empty list when no events match', () => {
    const internalOnly: TestEvent[] = [{ id: 'note', kind: 'system', visibility: 'internal' }]
    expect(filterTimelineEvents(internalOnly, 'customer_visible')).toEqual([])
    expect(filterTimelineEvents([], 'comments')).toEqual([])
  })
})

describe('isTimelineFilterId', () => {
  it('accepts every declared filter id', () => {
    for (const filter of TIMELINE_FILTERS) {
      expect(isTimelineFilterId(filter)).toBe(true)
    }
  })

  it('rejects unknown values', () => {
    expect(isTimelineFilterId('everything')).toBe(false)
    expect(isTimelineFilterId('')).toBe(false)
    expect(isTimelineFilterId('COMMENTS')).toBe(false)
  })

  it('narrows a string to TimelineFilterId', () => {
    const raw: string = 'status_changes'
    let narrowed: TimelineFilterId = 'all'
    if (isTimelineFilterId(raw)) {
      narrowed = raw
    }
    expect(narrowed).toBe('status_changes')
  })
})
