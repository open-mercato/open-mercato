/** @jest-environment node */
import { checkBookingRules, computeDaySlots, dayWindow, subtractRanges } from '../lib/bookingSlots'
import { endOfDay, localNow, normalizeWallClock, toStoredWallClock } from '../lib/wallClock'

const NOW = '2026-11-11T09:30'

describe('wall clock', () => {
  it('normalizes stored timestamps and keeps the whole day ending at the next midnight', () => {
    expect(normalizeWallClock('2026-11-12 10:00:00')).toBe('2026-11-12T10:00')
    expect(toStoredWallClock('2026-11-12T10:00')).toBe('2026-11-12T10:00:00')
    expect(endOfDay('2026-12-31')).toBe('2027-01-01T00:00')
    expect(localNow(new Date(2026, 10, 11, 7, 5))).toBe('2026-11-11T07:05')
  })
})

describe('computeDaySlots', () => {
  it('cuts a whole day into 24 hourly slots and marks booked hours', () => {
    const { openingHours, slots } = computeDaySlots({
      date: '2026-11-12',
      billingUnit: 'hour',
      booked: [{ start: '2026-11-12T10:00', end: '2026-11-12T12:00' }],
    })
    expect(openingHours).toBeNull()
    expect(slots).toHaveLength(24)
    expect(slots[0]).toEqual({ start: '2026-11-12T00:00', end: '2026-11-12T01:00', state: 'free' })
    expect(slots[23].end).toBe('2026-11-13T00:00')
    expect(slots.filter((slot) => slot.state === 'booked').map((slot) => slot.start)).toEqual(['2026-11-12T10:00', '2026-11-12T11:00'])
  })

  it('keeps slots inside an opening window and drops blocked ranges', () => {
    const { openingHours, slots } = computeDaySlots({
      date: '2026-11-12',
      billingUnit: 'hour',
      opening: { opensAt: '09:00', closesAt: '13:30' },
      blocked: [{ start: '2026-11-12T10:30', end: '2026-11-12T11:00' }],
    })
    expect(openingHours).toEqual([{ start: '2026-11-12T09:00', end: '2026-11-12T13:30' }])
    expect(slots.map((slot) => slot.start)).toEqual(['2026-11-12T09:00', '2026-11-12T11:00', '2026-11-12T12:00'])
  })

  it('offers one whole-day slot for daily products, none when part of the day is blocked', () => {
    const free = computeDaySlots({ date: '2026-11-12', billingUnit: 'day' })
    expect(free.slots).toEqual([{ start: '2026-11-12T00:00', end: '2026-11-13T00:00', state: 'free' }])
    const booked = computeDaySlots({ date: '2026-11-12', billingUnit: 'day', booked: [{ start: '2026-11-12T00:00', end: '2026-11-13T00:00' }] })
    expect(booked.slots[0].state).toBe('booked')
    const blocked = computeDaySlots({ date: '2026-11-12', billingUnit: 'day', blocked: [{ start: '2026-11-12T08:00', end: '2026-11-12T09:00' }] })
    expect(blocked.slots).toEqual([])
  })

  it('returns no slots for an invalid opening window', () => {
    expect(computeDaySlots({ date: '2026-11-12', billingUnit: 'hour', opening: { opensAt: '18:00', closesAt: '09:00' } })).toEqual({ openingHours: [], slots: [] })
    expect(dayWindow('2026-11-12', { opensAt: '25:00', closesAt: '26:00' })).toBeNull()
  })

  it('subtracts overlapping blocked ranges once', () => {
    const window = { start: '2026-11-12T08:00', end: '2026-11-12T18:00' }
    expect(subtractRanges(window, [
      { start: '2026-11-12T09:00', end: '2026-11-12T11:00' },
      { start: '2026-11-12T10:00', end: '2026-11-12T12:00' },
      { start: '2026-11-12T17:00', end: '2026-11-12T20:00' },
    ])).toEqual([
      { start: '2026-11-12T08:00', end: '2026-11-12T09:00' },
      { start: '2026-11-12T12:00', end: '2026-11-12T17:00' },
    ])
  })

  it('leaves out slots that have already ended, keeping the hour in progress like the booking rules', () => {
    const opening = { opensAt: '08:00', closesAt: '12:00' }
    const { slots } = computeDaySlots({ date: '2026-11-12', billingUnit: 'hour', opening, now: '2026-11-12T09:30' })
    expect(slots.map((slot) => slot.start)).toEqual(['2026-11-12T09:00', '2026-11-12T10:00', '2026-11-12T11:00'])
    for (const slot of slots) {
      expect(checkBookingRules({ startsAt: slot.start, endsAt: slot.end, billingUnit: 'hour', opening, now: '2026-11-12T09:30' }).ok).toBe(true)
    }
    expect(computeDaySlots({ date: '2026-11-12', billingUnit: 'hour', opening, now: '2026-11-12T12:00' }).slots).toEqual([])
    expect(computeDaySlots({ date: '2026-11-13', billingUnit: 'hour', opening, now: '2026-11-12T23:00' }).slots).toHaveLength(4)
  })

  it('offers the whole-day slot until the day has ended', () => {
    const opening = { opensAt: '08:00', closesAt: '18:00' }
    expect(computeDaySlots({ date: '2026-11-12', billingUnit: 'day', opening, now: '2026-11-12T17:59' }).slots).toHaveLength(1)
    expect(computeDaySlots({ date: '2026-11-12', billingUnit: 'day', opening, now: '2026-11-12T18:00' }).slots).toEqual([])
  })
})

describe('checkBookingRules', () => {
  const hourly = (startsAt: string, endsAt: string, now = NOW) => checkBookingRules({ startsAt, endsAt, billingUnit: 'hour', now })

  it('accepts 1 to 10 whole hours and counts them as the quantity', () => {
    expect(hourly('2026-11-12T10:00', '2026-11-12T11:00')).toEqual({ ok: true, quantity: 1 })
    expect(hourly('2026-11-12T08:00', '2026-11-12T18:00')).toEqual({ ok: true, quantity: 10 })
  })

  it('refuses bookings that are not on the hour, too long, reversed or across midnight', () => {
    expect(hourly('2026-11-12T10:30', '2026-11-12T11:30')).toEqual({ ok: false, issue: 'booking_not_on_the_hour' })
    expect(hourly('2026-11-12T10:00:30', '2026-11-12T11:00')).toEqual({ ok: false, issue: 'booking_not_on_the_hour' })
    expect(hourly('2026-11-12T08:00', '2026-11-12T19:00')).toEqual({ ok: false, issue: 'booking_too_long' })
    expect(hourly('2026-11-12T11:00', '2026-11-12T10:00')).toEqual({ ok: false, issue: 'booking_time_invalid' })
    expect(hourly('2026-11-12T23:00', '2026-11-13T01:00')).toEqual({ ok: false, issue: 'booking_crosses_midnight' })
    expect(hourly('2026-11-12T22:00', '2026-11-13T00:00')).toEqual({ ok: true, quantity: 2 })
  })

  it('refuses a booking whose first hour has already passed', () => {
    expect(hourly('2026-11-11T08:00', '2026-11-11T10:00')).toEqual({ ok: false, issue: 'booking_in_past' })
    expect(hourly('2026-11-11T09:00', '2026-11-11T11:00')).toEqual({ ok: true, quantity: 2 })
  })

  it('requires a daily booking to cover the whole window', () => {
    expect(checkBookingRules({ startsAt: '2026-11-12T00:00', endsAt: '2026-11-13T00:00', billingUnit: 'day', now: NOW })).toEqual({ ok: true, quantity: 1 })
    expect(checkBookingRules({ startsAt: '2026-11-12T09:00', endsAt: '2026-11-12T17:00', billingUnit: 'day', now: NOW })).toEqual({
      ok: false,
      issue: 'booking_not_whole_day',
    })
    expect(checkBookingRules({
      startsAt: '2026-11-12T09:00',
      endsAt: '2026-11-12T17:00',
      billingUnit: 'day',
      opening: { opensAt: '09:00', closesAt: '17:00' },
      now: NOW,
    })).toEqual({ ok: true, quantity: 1 })
  })

  it('refuses bookings outside the opening window and leasable billing units', () => {
    expect(checkBookingRules({
      startsAt: '2026-11-12T08:00',
      endsAt: '2026-11-12T10:00',
      billingUnit: 'hour',
      opening: { opensAt: '09:00', closesAt: '18:00' },
      now: NOW,
    })).toEqual({ ok: false, issue: 'booking_outside_opening_hours' })
    expect(checkBookingRules({ startsAt: '2026-11-12T08:00', endsAt: '2026-11-12T10:00', billingUnit: 'month', now: NOW })).toEqual({
      ok: false,
      issue: 'booking_billing_unit_invalid',
    })
  })

  it('accepts a daily booking of an opening window that is not on the hour', () => {
    const opening = { opensAt: '08:30', closesAt: '17:30' }
    expect(checkBookingRules({ startsAt: '2026-11-12T08:30', endsAt: '2026-11-12T17:30', billingUnit: 'day', opening, now: NOW })).toEqual({
      ok: true,
      quantity: 1,
    })
    expect(checkBookingRules({ startsAt: '2026-11-12T08:30', endsAt: '2026-11-12T10:00', billingUnit: 'hour', opening, now: NOW })).toEqual({
      ok: false,
      issue: 'booking_not_on_the_hour',
    })
  })
})
