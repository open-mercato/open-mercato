import { bookedVisitSubjects } from '../visitBookings'
import type { VisitAvailabilitySubject } from '../visitAvailability'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333'
const EVENT_ID = '44444444-4444-4444-8444-444444444444'
const scope = { tenantId: 'tenant', organizationId: 'organization' }
const input = { startAt: '2026-09-29T07:15:00Z', endAt: '2026-09-29T10:00:00Z', staffUserIds: [USER_ID], resourceIds: [RESOURCE_ID] }
const subjects: VisitAvailabilitySubject[] = [
  { type: 'staff', id: USER_ID, status: 'available', reasonKey: null },
  { type: 'resource', id: RESOURCE_ID, status: 'available', reasonKey: null },
]
const booking = {
  id: EVENT_ID, tenant_id: scope.tenantId, organization_id: scope.organizationId, deleted_at: null,
  interaction_type: 'meeting', status: 'planned', scheduled_at: '2026-09-29T08:00:00Z', duration_minutes: 30,
  participants: [{ userId: USER_ID }], linked_entities: [{ type: 'resource', id: RESOURCE_ID }],
  timezone: 'Europe/Warsaw',
}

function check(rows: Array<Record<string, unknown>>, proposed = input) {
  const query = jest.fn(async () => ({ items: rows, total: rows.length }))
  return { query, result: bookedVisitSubjects({ queryEngine: { query } as never, scope, input: proposed, subjects }) }
}

describe('Visit calendar bookings', () => {
  it.each(['meeting', 'call', 'task', 'visit', 'custom-event'])('checks assignments for %s without exposing event titles', async (interactionType) => {
    const { query, result } = check([{ ...booking, interaction_type: interactionType, title: 'Private consultation' }])
    expect(await result).toEqual(new Set([`staff:${USER_ID}`, `resource:${RESOURCE_ID}`]))
    expect(query).toHaveBeenCalledWith('customers:customer_interaction', expect.objectContaining({
      tenantId: scope.tenantId, organizationId: scope.organizationId, page: { page: 1, pageSize: 100 },
      filters: expect.objectContaining({ deleted_at: null, status: { $ne: 'canceled' } }),
    }))
    expect(query).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fields: expect.not.arrayContaining(['title', 'body']),
    }))
  })

  it('matches owner assignments and JSON resource links without requiring participants', async () => {
    expect(await check([{ ...booking, participants: null, owner_user_id: USER_ID,
      linked_entities: JSON.stringify(booking.linked_entities) }]).result)
      .toEqual(new Set([`staff:${USER_ID}`, `resource:${RESOURCE_ID}`]))
  })

  it.each([
    ['2026-09-29T06:45:00Z', 30],
    ['2026-09-29T10:00:00Z', 30],
  ])('allows endpoint touching at %s', async (scheduledAt, durationMinutes) => {
    expect(await check([{ ...booking, scheduled_at: scheduledAt, duration_minutes: durationMinutes }]).result).toEqual(new Set())
  })

  it('ignores canceled, deleted, foreign-scope and unrelated assignments', async () => {
    expect(await check([
      { ...booking, status: 'canceled' }, { ...booking, deleted_at: '2026-09-30T00:00:00Z' },
      { ...booking, tenant_id: 'other' }, { ...booking, organization_id: 'other' },
      { ...booking, participants: [], linked_entities: [] },
    ]).result).toEqual(new Set())
  })

  it('excludes the event being edited in the scoped query and results', async () => {
    const query = jest.fn(async () => ({ items: [booking], total: 1 }))
    expect(await bookedVisitSubjects({ queryEngine: { query } as never, scope,
      input: { ...input, excludeInteractionId: EVENT_ID }, subjects })).toEqual(new Set())
    expect(query).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      filters: expect.objectContaining({ id: { $ne: EVENT_ID } }),
    }))
  })

  it('expands Warsaw weekly bookings at the same wall time after DST', async () => {
    const proposed = { ...input, startAt: '2026-03-29T07:15:00Z', endAt: '2026-03-29T08:00:00Z' }
    expect(await check([{ ...booking, scheduled_at: '2026-03-22T08:00:00Z', duration_minutes: 60,
      recurrence_rule: 'FREQ=WEEKLY;BYDAY=SU;COUNT=3' }], proposed).result)
      .toEqual(new Set([`staff:${USER_ID}`, `resource:${RESOURCE_ID}`]))
  })

  it.each([
    { recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=1' },
    { recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20260922T090000Z' },
    { recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU', recurrence_end: '2026-09-22T21:59:59Z' },
  ])('respects recurrence bounds %j', async (bounds) => {
    expect(await check([{ ...booking, scheduled_at: '2026-09-22T08:00:00Z', ...bounds }]).result).toEqual(new Set())
  })

  it('checks all-day bookings across the full event-local day', async () => {
    expect(await check([{ ...booking, scheduled_at: '2026-09-29T12:00:00Z', all_day: true }]).result)
      .toEqual(new Set([`staff:${USER_ID}`, `resource:${RESOURCE_ID}`]))
  })

  it.each(['2026-09-28T08:00:00Z', input.startAt, input.endAt])('allows a zero-duration event outside or touching the interval at %s', async (scheduledAt) => {
    expect(await check([{ ...booking, scheduled_at: scheduledAt, duration_minutes: 0 }]).result).toEqual(new Set())
  })

  it('matches Customers conflict semantics for an instant strictly inside the interval', async () => {
    expect(await check([{ ...booking, duration_minutes: 0 }]).result)
      .toEqual(new Set([`staff:${USER_ID}`, `resource:${RESOURCE_ID}`]))
  })

  it('keeps a zero-duration all-day event occupied for its mapped calendar date', async () => {
    expect(await check([{ ...booking, duration_minutes: 0, all_day: true }]).result)
      .toEqual(new Set([`staff:${USER_ID}`, `resource:${RESOURCE_ID}`]))
  })

  it('fails closed for a bounded daily rule restricted by weekday instead of missing its second Monday', async () => {
    const proposed = { ...input, startAt: '2026-10-05T07:15:00Z', endAt: '2026-10-05T08:00:00Z' }
    await expect(check([{ ...booking, scheduled_at: '2026-09-28T07:00:00Z', duration_minutes: 60,
      recurrence_rule: 'FREQ=DAILY;BYDAY=MO;COUNT=2' }], proposed).result)
      .rejects.toThrow('[internal] Unsupported booking recurrence')
  })

  it.each([
    { recurrence_rule: 'FREQ=MONTHLY' }, { timezone: 'Invalid/Zone' },
    { scheduled_at: 'bad' }, { duration_minutes: -30 },
  ])('fails closed for unsupported or malformed assigned bookings %j', async (invalid) => {
    await expect(check([{ ...booking, ...invalid }]).result).rejects.toThrow()
  })

  it('paginates with bounded pages and detects a conflict beyond the first page', async () => {
    const query = jest.fn(async (_entity: string, options: { page: { page: number; pageSize: number } }) => {
      expect(options.page.pageSize).toBe(100)
      return options.page.page === 1
        ? { items: Array.from({ length: 100 }, (_, index) => ({ ...booking, id: `other-${index}`, participants: [], linked_entities: [] })), total: 101 }
        : { items: [booking], total: 101 }
    })
    expect(await bookedVisitSubjects({ queryEngine: { query } as never, scope, input, subjects }))
      .toEqual(new Set([`staff:${USER_ID}`, `resource:${RESOURCE_ID}`]))
    expect(query).toHaveBeenCalledTimes(2)
  })

  it.each([1001, Number.NaN])('fails closed on unsafe totals %s', async (total) => {
    const query = jest.fn(async () => ({ items: [], total }))
    await expect(bookedVisitSubjects({ queryEngine: { query } as never, scope, input, subjects })).rejects.toThrow()
  })

  it('fails closed if the booking source is unavailable or pagination is incomplete', async () => {
    for (const query of [jest.fn(async () => { throw new Error('Unavailable') }), jest.fn(async () => ({ items: [], total: 1 }))]) {
      await expect(bookedVisitSubjects({ queryEngine: { query } as never, scope, input, subjects })).rejects.toThrow()
    }
  })
})
