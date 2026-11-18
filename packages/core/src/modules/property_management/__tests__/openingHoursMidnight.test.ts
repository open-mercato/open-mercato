/** @jest-environment node */
import { openingHoursSchema } from '../data/validators'
import { checkBookingRules, computeDaySlots, dayWindow } from '../lib/bookingSlots'
import { openingWindowFor, openWindowsCondition, toWeeklyHours } from '../lib/openingHours'
import { fallbackClosingTime, openingHoursPayload, openingRowsOf } from '../components/buildings/openingHoursRows'

describe('opening hours that close at midnight', () => {
  it('accepts 24:00 as a closing time only', () => {
    expect(openingHoursSchema.parse([{ weekday: 0, opensAt: '08:00', closesAt: '24:00' }])).toEqual([{ weekday: 0, opensAt: '08:00', closesAt: '24:00' }])
    expect(openingHoursSchema.parse([{ weekday: 1, opensAt: '00:00:00', closesAt: '24:00:00' }])).toEqual([{ weekday: 1, opensAt: '00:00', closesAt: '24:00' }])
    expect(openingHoursSchema.safeParse([{ weekday: 0, opensAt: '24:00', closesAt: '24:00' }]).success).toBe(false)
    expect(openingHoursSchema.safeParse([{ weekday: 0, opensAt: '08:00', closesAt: '24:30' }]).success).toBe(false)
    expect(openingHoursSchema.safeParse([{ weekday: 0, opensAt: '08:00', closesAt: '25:00' }]).success).toBe(false)
  })

  it('offers slots up to midnight and accepts a booking ending at midnight', () => {
    const opening = { opensAt: '20:00', closesAt: '24:00' }
    expect(dayWindow('2026-11-18', opening)).toEqual({ start: '2026-11-18T20:00', end: '2026-11-19T00:00' })
    const { slots } = computeDaySlots({ date: '2026-11-18', billingUnit: 'hour', opening })
    expect(slots.map((slot) => slot.start)).toEqual(['2026-11-18T20:00', '2026-11-18T21:00', '2026-11-18T22:00', '2026-11-18T23:00'])
    expect(slots[3].end).toBe('2026-11-19T00:00')
    expect(checkBookingRules({ startsAt: '2026-11-18T22:00', endsAt: '2026-11-19T00:00', billingUnit: 'hour', opening, now: '2026-11-17T09:00' })).toEqual({ ok: true, quantity: 2 })
    expect(computeDaySlots({ date: '2026-11-18', billingUnit: 'day', opening }).slots).toEqual([
      { start: '2026-11-18T20:00', end: '2026-11-19T00:00', state: 'free' },
    ])
  })

  it('treats a stored 24:00:00 closing time as open until midnight', () => {
    const weekly = toWeeklyHours([{ weekday: 2, opensAt: '20:00:00', closesAt: '24:00:00' }])
    const opening = { enabled: true, weekly }
    expect(
      checkBookingRules({ startsAt: '2026-11-18T23:00', endsAt: '2026-11-19T00:00', billingUnit: 'hour', opening: openingWindowFor(opening, '2026-11-18'), now: '2026-11-17T09:00' }),
    ).toEqual({ ok: true, quantity: 1 })
    expect(openWindowsCondition(opening).params).toEqual([3, 20 * 60, 24 * 60])
  })

  it('keeps a midnight close in the form rows and payload', () => {
    const rows = openingRowsOf([{ weekday: 4, opensAt: '18:00', closesAt: '24:00' }], true)
    expect(rows[4]).toEqual({ weekday: 4, open: true, opensAt: '18:00', closesAt: '24:00' })
    expect(openingHoursPayload(rows)).toEqual({ entries: [{ weekday: 4, opensAt: '18:00', closesAt: '24:00' }], invalidWeekday: null })
  })

  it('never closes at or before the opening time when a day stops closing at midnight', () => {
    expect(fallbackClosingTime('09:00')).toBe('18:00')
    expect(fallbackClosingTime('18:00')).toBe('23:45')
    expect(fallbackClosingTime('23:30')).toBe('23:45')
    expect(fallbackClosingTime('23:45')).toBe('24:00')
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const opensAt = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
      const row = { weekday: 0, open: true, opensAt, closesAt: fallbackClosingTime(opensAt) }
      expect(openingHoursPayload([row]).invalidWeekday).toBeNull()
    }
  })
})
