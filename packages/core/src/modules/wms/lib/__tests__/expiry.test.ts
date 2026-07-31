/** @jest-environment node */

import {
  addUtcDays,
  buildExpiryWindowDateFilter,
  EXPIRING_SOON_DAYS,
  startOfUtcDay,
} from '../expiry'

describe('expiry helpers', () => {
  it('startOfUtcDay normalizes to UTC midnight', () => {
    expect(startOfUtcDay(new Date('2026-05-28T23:59:59.999Z')).toISOString()).toBe(
      '2026-05-28T00:00:00.000Z',
    )
    expect(startOfUtcDay(new Date('2026-05-29T00:00:00.001Z')).toISOString()).toBe(
      '2026-05-29T00:00:00.000Z',
    )
  })

  it('addUtcDays advances across month boundaries in UTC', () => {
    const today = startOfUtcDay(new Date('2026-05-30T12:00:00.000Z'))
    expect(addUtcDays(today, 2).toISOString()).toBe('2026-06-01T00:00:00.000Z')
  })

  it('buildExpiryWindowDateFilter pastDue uses expires before today start', () => {
    const now = new Date('2026-06-01T15:30:00.000Z')
    const today = startOfUtcDay(now)

    expect(buildExpiryWindowDateFilter('pastDue', now)).toEqual({
      expires_at: { $ne: null, $lt: today },
    })
  })

  it('buildExpiryWindowDateFilter expiringSoon spans today through horizon', () => {
    const now = new Date('2026-06-01T15:30:00.000Z')
    const today = startOfUtcDay(now)

    expect(buildExpiryWindowDateFilter('expiringSoon', now)).toEqual({
      expires_at: {
        $ne: null,
        $gte: today,
        $lte: addUtcDays(today, EXPIRING_SOON_DAYS),
      },
    })
  })

  it('pastDue and expiringSoon do not overlap at UTC midnight boundary', () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    const pastDue = buildExpiryWindowDateFilter('pastDue', now)
    const expiringSoon = buildExpiryWindowDateFilter('expiringSoon', now)

    const pastDueUpper = (pastDue.expires_at as { $lt: Date }).$lt
    const expiringSoonLower = (expiringSoon.expires_at as { $gte: Date }).$gte

    expect(pastDueUpper.getTime()).toBe(expiringSoonLower.getTime())
  })
})
