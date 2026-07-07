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
