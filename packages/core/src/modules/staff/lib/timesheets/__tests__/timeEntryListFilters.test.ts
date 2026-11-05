import { normalizeFilters } from '@open-mercato/shared/lib/query/join-utils'
import { buildTimeEntryListFilters } from '../timeEntryListFilters'

describe('buildTimeEntryListFilters — running filter (issue #3717)', () => {
  it('matches the open timer regardless of date when running=true', () => {
    const filters = buildTimeEntryListFilters({ staffMemberId: 'staff-1', running: 'true' })

    expect(filters.started_at).toEqual({ $ne: null })
    expect(filters.ended_at).toBeNull()
    // A running lookup must NOT scope by date — an overnight timer is off "today".
    expect(filters.date).toBeUndefined()
    expect(filters.staff_member_id).toBe('staff-1')
  })

  it('does not apply the running filter when running is absent or false', () => {
    expect(buildTimeEntryListFilters({ staffMemberId: 'staff-1' }).started_at).toBeUndefined()
    expect(buildTimeEntryListFilters({ staffMemberId: 'staff-1', running: 'false' }).started_at).toBeUndefined()
    expect(buildTimeEntryListFilters({ staffMemberId: 'staff-1', running: 'false' }).ended_at).toBeUndefined()
  })

  it('keeps the date-window filter intact for the historical list view', () => {
    const filters = buildTimeEntryListFilters({ from: '2026-06-30', to: '2026-06-30' })

    expect(filters.date).toEqual({ $gte: '2026-06-30', $lte: '2026-06-30' })
    expect(filters.started_at).toBeUndefined()
    expect(filters.ended_at).toBeUndefined()
  })

  it('can combine a running lookup with a project filter', () => {
    const filters = buildTimeEntryListFilters({ running: 'true', projectId: 'project-9' })

    expect(filters.started_at).toEqual({ $ne: null })
    expect(filters.ended_at).toBeNull()
    expect(filters.time_project_id).toBe('project-9')
  })

  it('parses id lists and ignores blank entries', () => {
    const filters = buildTimeEntryListFilters({ ids: 'a, ,b' })
    expect(filters.id).toEqual({ $in: ['a', 'b'] })
  })
})

describe('buildTimeEntryListFilters — query-engine normalization (issue #4841)', () => {
  it('normalizes the running lookup to null-comparison clauses the engine must honor', () => {
    const clauses = normalizeFilters(buildTimeEntryListFilters({ running: 'true' }))

    // The bare `ended_at: null` must survive as an `eq` against null rather than
    // being dropped — a dropped clause would silently widen the running lookup.
    expect(clauses).toEqual(
      expect.arrayContaining([
        { field: 'started_at', op: 'ne', value: null },
        { field: 'ended_at', op: 'eq', value: null },
      ]),
    )
  })
})
