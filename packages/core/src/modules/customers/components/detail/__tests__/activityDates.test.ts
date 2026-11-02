/**
 * @jest-environment jsdom
 *
 * Regression tests for issue #8286 — the Activities UI must never use an
 * activity's `created_at` (materialisation time) as its occurrence date. `NULL`
 * occurrences stay undated and sort last, both in the shared compare helper and
 * at every render site that consumes it.
 */
import type { InteractionSummary } from '../types'
import {
  activityOccurrenceDate,
  compareActivitiesByOccurrence,
} from '../activityDates'

function createActivity(overrides: Partial<InteractionSummary> = {}): InteractionSummary {
  return {
    id: 'activity-1',
    interactionType: 'task',
    title: 'Some activity',
    body: null,
    status: 'done',
    scheduledAt: null,
    occurredAt: null,
    priority: null,
    authorUserId: null,
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: 'manual',
    entityId: 'person-1',
    dealId: null,
    organizationId: null,
    tenantId: null,
    authorName: null,
    authorEmail: null,
    dealTitle: null,
    customValues: null,
    createdAt: '2026-03-01T09:00:00.000Z',
    updatedAt: '2026-03-01T09:00:00.000Z',
    ...overrides,
  }
}

describe('activityOccurrenceDate (issue #8286)', () => {
  it('prefers occurred_at over scheduled_at and created_at', () => {
    const activity = createActivity({
      occurredAt: '2026-05-01T09:00:00.000Z',
      scheduledAt: '2026-04-01T09:00:00.000Z',
      createdAt: '2026-03-01T09:00:00.000Z',
    })
    expect(activityOccurrenceDate(activity)).toBe('2026-05-01T09:00:00.000Z')
  })

  it('falls back to scheduled_at when occurred_at is null', () => {
    const activity = createActivity({
      occurredAt: null,
      scheduledAt: '2026-06-15T10:00:00.000Z',
      createdAt: '2026-03-01T09:00:00.000Z',
    })
    expect(activityOccurrenceDate(activity)).toBe('2026-06-15T10:00:00.000Z')
  })

  it('returns null when neither occurred_at nor scheduled_at exists — never created_at', () => {
    // The regression: an undated task must not surface its created_at as a date.
    const activity = createActivity({ occurredAt: null, scheduledAt: null, createdAt: '2026-03-01T09:00:00.000Z' })
    expect(activityOccurrenceDate(activity)).toBeNull()
  })
})

describe('compareActivitiesByOccurrence (issue #8286)', () => {
  it('never orders an undated activity by its created_at against a dated one', () => {
    // `undated` has a *later* created_at than `dated`'s occurred_at; if created_at
    // were used as a fake occurrence date, it could interleave before/after the
    // dated item. The fix pushes the undated activity to the end regardless of
    // its created_at, in both directions.
    const dated = createActivity({ id: 'dated', occurredAt: '2026-01-10T09:00:00.000Z', createdAt: '2026-03-01T00:00:00.000Z' })
    const undated = createActivity({ id: 'undated', occurredAt: null, scheduledAt: null, createdAt: '2026-06-01T00:00:00.000Z' })

    expect(
      [undated, dated].sort((left, right) => compareActivitiesByOccurrence(left, right, 'desc')).map((a) => a.id),
    ).toEqual(['dated', 'undated'])

    expect(
      [undated, dated].sort((left, right) => compareActivitiesByOccurrence(left, right, 'asc')).map((a) => a.id),
    ).toEqual(['dated', 'undated'])
  })

  it('sorts two dated activities by occurred_at desc (newest first)', () => {
    const older = createActivity({ id: 'older', occurredAt: '2026-01-01T00:00:00.000Z' })
    const newer = createActivity({ id: 'newer', occurredAt: '2026-06-01T00:00:00.000Z' })
    expect(
      [older, newer].sort((left, right) => compareActivitiesByOccurrence(left, right, 'desc')).map((a) => a.id),
    ).toEqual(['newer', 'older'])
  })

  it('uses scheduled_at as the occurrence surrogate for an upcoming task', () => {
    const scheduledSoon = createActivity({ id: 'scheduled', occurredAt: null, scheduledAt: '2026-12-31T09:00:00.000Z' })
    const occurredLongAgo = createActivity({ id: 'occurred', occurredAt: '2026-01-01T00:00:00.000Z' })
    // scheduled_at acts as the occurrence surrogate so the near-future scheduled
    // item outranks the long-past occurred item when desc.
    expect(
      [occurredLongAgo, scheduledSoon].sort((left, right) => compareActivitiesByOccurrence(left, right, 'desc')).map((a) => a.id),
    ).toEqual(['scheduled', 'occurred'])
  })

  it('keeps the id-descending tie-break for activities sharing an occurrence date', () => {
    // Preserves the previous behavior that the "filters timeline by search term"
    // test relies on: equal-time items fall back to a deterministic id order.
    const a = createActivity({ id: 'a', occurredAt: '2026-03-29T09:00:00.000Z' })
    const b = createActivity({ id: 'b', occurredAt: '2026-03-29T09:00:00.000Z' })
    expect([a, b].sort((left, right) => compareActivitiesByOccurrence(left, right, 'desc')).map((x) => x.id)).toEqual(['b', 'a'])
  })
})
