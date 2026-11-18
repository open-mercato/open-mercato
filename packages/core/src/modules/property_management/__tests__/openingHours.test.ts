/** @jest-environment node */
import { Booking, OpeningHours } from '../data/entities'
import { checkBookingRules, computeDaySlots } from '../lib/bookingSlots'
import {
  CLOSED_WINDOW,
  findBookingsOutsideHours,
  openingWindowFor,
  openWindowsCondition,
  replaceOpeningHours,
  toWeeklyHours,
  weekdayOf,
  type BuildingOpening,
} from '../lib/openingHours'
import { blockedRangesForDay } from '../lib/availabilityResolver'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }

const weekdays: BuildingOpening = {
  enabled: true,
  weekly: toWeeklyHours([
    { weekday: 0, opensAt: '09:00:00', closesAt: '18:00:00' },
    { weekday: 1, opensAt: '09:00', closesAt: '18:00' },
    { weekday: 5, opensAt: '10:00', closesAt: '14:00' },
  ]),
}

describe('weekdays and windows', () => {
  it('numbers weekdays from Monday = 0', () => {
    expect(weekdayOf('2026-11-09')).toBe(0)
    expect(weekdayOf('2026-11-14')).toBe(5)
    expect(weekdayOf('2026-11-15')).toBe(6)
  })

  it('returns no window when hours are off and a closed window for a missing weekday', () => {
    expect(openingWindowFor({ enabled: false, weekly: weekdays.weekly }, '2026-11-09')).toBeNull()
    expect(openingWindowFor(null, '2026-11-09')).toBeNull()
    expect(openingWindowFor(weekdays, '2026-11-09')).toEqual({ opensAt: '09:00', closesAt: '18:00' })
    expect(openingWindowFor(weekdays, '2026-11-15')).toBe(CLOSED_WINDOW)
  })

  it('checks whether a booking fits in the day window', () => {
    const fits = (startsAt: string, endsAt: string, opening: BuildingOpening) =>
      checkBookingRules({ startsAt, endsAt, billingUnit: 'hour', opening: openingWindowFor(opening, startsAt.slice(0, 10)), now: '2026-11-01T00:00' })
    expect(fits('2026-11-09T09:00', '2026-11-09T18:00', weekdays)).toEqual({ ok: true, quantity: 9 })
    expect(fits('2026-11-09T08:00', '2026-11-09T10:00', weekdays)).toEqual({ ok: false, issue: 'booking_outside_opening_hours' })
    expect(fits('2026-11-15T10:00', '2026-11-15T11:00', weekdays)).toEqual({ ok: false, issue: 'booking_outside_opening_hours' })
    expect(fits('2026-11-15T10:00', '2026-11-15T11:00', { enabled: false, weekly: new Map() })).toEqual({ ok: true, quantity: 1 })
  })
})

describe('slots with opening hours', () => {
  it('offers only the hours inside the weekday window', () => {
    const { openingHours, slots } = computeDaySlots({ date: '2026-11-14', billingUnit: 'hour', opening: openingWindowFor(weekdays, '2026-11-14') })
    expect(openingHours).toEqual([{ start: '2026-11-14T10:00', end: '2026-11-14T14:00' }])
    expect(slots.map((slot) => slot.start)).toEqual(['2026-11-14T10:00', '2026-11-14T11:00', '2026-11-14T12:00', '2026-11-14T13:00'])
  })

  it('offers nothing on a closed day', () => {
    const { openingHours, slots } = computeDaySlots({ date: '2026-11-15', billingUnit: 'hour', opening: openingWindowFor(weekdays, '2026-11-15') })
    expect(openingHours).toEqual([])
    expect(slots).toEqual([])
    expect(computeDaySlots({ date: '2026-11-15', billingUnit: 'day', opening: CLOSED_WINDOW }).slots).toEqual([])
  })

  it('a daily product books the whole opening window, and none when a closure touches it', () => {
    const opening = openingWindowFor(weekdays, '2026-11-09')
    expect(computeDaySlots({ date: '2026-11-09', billingUnit: 'day', opening }).slots).toEqual([
      { start: '2026-11-09T09:00', end: '2026-11-09T18:00', state: 'free' },
    ])
    const blocked = blockedRangesForDay(
      [{ id: 'u', source: 'space', subjectId: 's', reasonEntryId: null, reasonText: 'Works', start: '2026-11-09T17:00', end: null }],
      '2026-11-09',
    )
    expect(computeDaySlots({ date: '2026-11-09', billingUnit: 'day', opening, blocked }).slots).toEqual([])
    expect(computeDaySlots({ date: '2026-11-09', billingUnit: 'hour', opening, blocked }).slots).toHaveLength(8)
  })

  it('refuses a booking outside the window and accepts one inside', () => {
    const now = '2026-11-01T08:00'
    const opening = openingWindowFor(weekdays, '2026-11-09')
    expect(checkBookingRules({ startsAt: '2026-11-09T08:00', endsAt: '2026-11-09T10:00', billingUnit: 'hour', opening, now })).toEqual({
      ok: false,
      issue: 'booking_outside_opening_hours',
    })
    expect(checkBookingRules({ startsAt: '2026-11-09T17:00', endsAt: '2026-11-09T19:00', billingUnit: 'hour', opening, now })).toEqual({
      ok: false,
      issue: 'booking_outside_opening_hours',
    })
    expect(checkBookingRules({ startsAt: '2026-11-15T10:00', endsAt: '2026-11-15T11:00', billingUnit: 'hour', opening: CLOSED_WINDOW, now })).toEqual({
      ok: false,
      issue: 'booking_outside_opening_hours',
    })
    expect(checkBookingRules({ startsAt: '2026-11-09T09:00', endsAt: '2026-11-09T11:00', billingUnit: 'hour', opening, now })).toEqual({ ok: true, quantity: 2 })
    expect(checkBookingRules({ startsAt: '2026-11-09T09:00', endsAt: '2026-11-09T18:00', billingUnit: 'day', opening, now })).toEqual({ ok: true, quantity: 1 })
  })
})

describe('slots on a day the clocks change', () => {
  const originalTz = process.env.TZ

  beforeAll(() => {
    process.env.TZ = 'Europe/Warsaw'
  })

  afterAll(() => {
    process.env.TZ = originalTz
  })

  it.each([
    ['spring forward', '2026-03-29'],
    ['fall back', '2026-10-25'],
  ])('keeps wall-clock hours on the %s day', (_label, date) => {
    const opening = { opensAt: '00:00', closesAt: '06:00' }
    const { slots } = computeDaySlots({ date, billingUnit: 'hour', opening })
    expect(slots.map((slot) => slot.start.slice(11))).toEqual(['00:00', '01:00', '02:00', '03:00', '04:00', '05:00'])
    expect(computeDaySlots({ date, billingUnit: 'hour' }).slots).toHaveLength(24)
    expect(checkBookingRules({ startsAt: `${date}T02:00`, endsAt: `${date}T04:00`, billingUnit: 'hour', opening, now: '2026-01-01T00:00' })).toEqual({
      ok: true,
      quantity: 2,
    })
  })
})

describe('replacing hours and the bookings now outside them', () => {
  it('replaces the weekly set', async () => {
    const em = new FakeEm()
    em.seed(OpeningHours, { id: 'old', ...scope, buildingId: 'b1', weekday: 3, opensAt: '08:00:00', closesAt: '20:00:00' } as never)
    await replaceOpeningHours(em as never, scope, 'b1', [{ weekday: 0, opensAt: '10:00', closesAt: '16:00' }])
    const rows = em.rows(OpeningHours)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ weekday: 0, opensAt: '10:00:00', closesAt: '16:00:00' })
  })

  it('filters the upcoming bookings outside the hours in SQL, with a limit, and counts all of them', async () => {
    const em = new FakeEm()
    const base = { ...scope, buildingId: 'b1', unitId: 'u1', productName: 'Meeting room', status: 'confirmed', deletedAt: null }
    em.seed(Booking, { id: 'early', ...base, startsAt: '2026-11-16T09:00:00', endsAt: '2026-11-16T11:00:00' } as never)
    em.seed(Booking, { id: 'closed-day', ...base, startsAt: '2026-11-17T10:00:00', endsAt: '2026-11-17T11:00:00' } as never)
    em.respond = () => [{ id: 'early', total: '250' }, { id: 'closed-day', total: '250' }]
    const opening = { enabled: true, weekly: toWeeklyHours([{ weekday: 0, opensAt: '10:00:00', closesAt: '16:00:00' }]) }
    const outside = await findBookingsOutsideHours(em as never, scope, 'b1', opening, '2026-11-11T09:00', 2)
    expect(outside.total).toBe(250)
    expect(outside.bookings).toEqual([
      expect.objectContaining({ id: 'early', kind: 'booking', unitId: 'u1', startsAt: '2026-11-16T09:00', endsAt: '2026-11-16T11:00', label: 'Meeting room · 2026-11-16T09:00' }),
      expect.objectContaining({ id: 'closed-day', startsAt: '2026-11-17T10:00', endsAt: '2026-11-17T11:00' }),
    ])
    expect(em.executed).toHaveLength(1)
    const [query] = em.executed
    expect(query.sql).toContain('count(*) over ()')
    expect(query.sql).toContain('not ((extract(isodow from starts_at) = ?::int')
    expect(query.sql).toMatch(/limit \?::int$/)
    expect(query.params).toEqual([ORG, TENANT, 'b1', 'pending', 'confirmed', '2026-11-11T09:00:00', 1, 600, 960, 2])
  })

  it('treats every day without a valid window as closed and skips the query when hours are off', async () => {
    expect(openWindowsCondition({ enabled: true, weekly: new Map() })).toEqual({ sql: 'false', params: [] })
    const condition = openWindowsCondition({
      enabled: true,
      weekly: toWeeklyHours([
        { weekday: 6, opensAt: '00:00', closesAt: '24:00' },
        { weekday: 2, opensAt: '12:00', closesAt: '09:00' },
        { weekday: 1, opensAt: '08:30', closesAt: '17:15' },
      ]),
    })
    expect(condition.params).toEqual([2, 510, 1035, 7, 0, 1440])
    const em = new FakeEm()
    expect(await findBookingsOutsideHours(em as never, scope, 'b1', { enabled: false, weekly: new Map() }, '2026-11-11T09:00')).toEqual({ bookings: [], total: 0 })
    em.respond = () => []
    expect(await findBookingsOutsideHours(em as never, scope, 'b1', { enabled: true, weekly: new Map() }, '2026-11-11T09:00')).toEqual({ bookings: [], total: 0 })
    expect(em.executed).toHaveLength(1)
  })
})
