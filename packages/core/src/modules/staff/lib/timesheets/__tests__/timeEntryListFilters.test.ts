import { normalizeFilters } from '@open-mercato/shared/lib/query/join-utils'
import { buildTimeEntryListFilters } from '../timeEntryListFilters'

/**
 * Asserting the filter MAP alone cannot tell `{ $ne: null }` from `{ $exists: true }`,
 * because the SQL they produce depends on which dispatcher the field resolves to
 * (`packages/shared/src/lib/query/engine.ts`):
 *
 * - `applyColumnOp` — fields backed by a real base column. Null-guarded: `case 'ne'`
 *   with a `null` value emits `is not null`, `case 'eq'` emits `is null`. Both
 *   spellings work here.
 * - `applyIndexDocFilter` — fields resolved from `entity_indexes.doc` because
 *   `resolveBaseColumn` found no column. NOT null-guarded: `eq`/`ne` emit
 *   `doc->>'field' = NULL` / `<> NULL`, which are UNKNOWN and match zero rows.
 *
 * `case 'exists'` emits `is not null` / `is null` on both. This helper models the
 * index-doc dispatcher — the strict one — so the filter is pinned to the spelling
 * that is correct no matter how the field resolves.
 */
type NullSemantics = 'IS NOT NULL' | 'IS NULL' | 'UNSAFE ON INDEX-DOC PATH'

function nullSemanticsOf(filter: unknown): NullSemantics {
  if (filter !== null && typeof filter === 'object' && !Array.isArray(filter)) {
    const entries = Object.entries(filter as Record<string, unknown>)
    if (entries.length === 1) {
      const [op, value] = entries[0]
      if (op === '$exists') return value ? 'IS NOT NULL' : 'IS NULL'
      if ((op === '$ne' || op === '$eq') && value === null) return 'UNSAFE ON INDEX-DOC PATH'
    }
  }
  // A bare `null` value is dispatched as `eq`.
  if (filter === null) return 'UNSAFE ON INDEX-DOC PATH'
  return 'IS NOT NULL'
}

describe('buildTimeEntryListFilters — running filter (issue #3717)', () => {
  it('matches the open timer regardless of date when running=true', () => {
    const filters = buildTimeEntryListFilters({ staffMemberId: 'staff-1', running: 'true' })

    expect(filters.started_at).toEqual({ $exists: true })
    expect(filters.ended_at).toEqual({ $exists: false })
    // A running lookup must NOT scope by date — an overnight timer is off "today".
    expect(filters.date).toBeUndefined()
    expect(filters.staff_member_id).toBe('staff-1')
  })

  it('renders as IS NOT NULL / IS NULL, never a null equality comparison', () => {
    const filters = buildTimeEntryListFilters({ staffMemberId: 'staff-1', running: 'true' })

    expect(nullSemanticsOf(filters.started_at)).toBe('IS NOT NULL')
    expect(nullSemanticsOf(filters.ended_at)).toBe('IS NULL')
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

    expect(filters.started_at).toEqual({ $exists: true })
    expect(filters.ended_at).toEqual({ $exists: false })
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

    // Both clauses must survive normalization — a dropped clause would silently
    // widen the running lookup. They normalize as `exists`, not as null equality:
    // the engine renders `ne`/`eq` against null as SQL `!= NULL` / `= NULL`, which
    // are UNKNOWN under three-valued logic and match zero rows (see #3717).
    expect(clauses).toEqual(
      expect.arrayContaining([
        { field: 'started_at', op: 'exists', value: true },
        { field: 'ended_at', op: 'exists', value: false },
      ]),
    )
    expect(clauses.some((clause) => clause.value === null)).toBe(false)
  })
})
