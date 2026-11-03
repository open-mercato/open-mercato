import {
  MAX_PAUSE_DAYS,
  PREFERENCE_WINDOW_HOURS,
  frequencyWindowStart,
  isFrequencyCapped,
  isPaused,
  isWithinQuietHours,
  localHourIn,
  nextAllowedSendTime,
  nextOccurrenceOfHour,
  preferenceCap,
} from '../gates'

describe('isFrequencyCapped', () => {
  const cap = { maxMessages: 3, windowHours: 24 }

  test('allows sends below the cap and blocks at or above it', () => {
    expect(isFrequencyCapped(0, cap)).toBe(false)
    expect(isFrequencyCapped(2, cap)).toBe(false)
    expect(isFrequencyCapped(3, cap)).toBe(true)
    expect(isFrequencyCapped(9, cap)).toBe(true)
  })

  // An absent or nonsensical cap must not block sending — the feature is opt-in, and a
  // misconfigured cap that silently stopped all mail would be very hard to diagnose.
  test.each([[null], [undefined], [{ maxMessages: 0, windowHours: 24 }], [{ maxMessages: 3, windowHours: 0 }]])(
    'treats %p as no cap',
    (cap) => {
      expect(isFrequencyCapped(100, cap as never)).toBe(false)
    },
  )
})

describe('frequencyWindowStart', () => {
  test('is the window length behind the clock', () => {
    const at = new Date('2026-09-28T12:00:00.000Z')
    expect(frequencyWindowStart(at, { maxMessages: 1, windowHours: 24 }).toISOString())
      .toBe('2026-09-27T12:00:00.000Z')
  })
})

describe('localHourIn', () => {
  test('resolves the hour in the subject timezone', () => {
    const at = new Date('2026-06-15T22:30:00.000Z')
    expect(localHourIn('UTC', at)).toBe(22)
    expect(localHourIn('Europe/Warsaw', at)).toBe(0) // CEST, next day
    expect(localHourIn('America/New_York', at)).toBe(18)
  })

  test('handles the midnight hour as 0 rather than 24', () => {
    expect(localHourIn('UTC', new Date('2026-06-15T00:15:00.000Z'))).toBe(0)
  })

  // Customer data supplies this string, so a typo must degrade to UTC rather than throw and
  // stop the send.
  test('falls back to UTC for a timezone Intl rejects', () => {
    const at = new Date('2026-06-15T22:30:00.000Z')
    expect(localHourIn('Not/AZone', at)).toBe(22)
  })
})

describe('isWithinQuietHours', () => {
  const overnight = { startHour: 21, endHour: 8 }
  const daytime = { startHour: 9, endHour: 17 }

  test('no window configured means never quiet', () => {
    expect(isWithinQuietHours(null, 'UTC', new Date('2026-06-15T03:00:00.000Z'))).toBe(false)
  })

  test('a window that wraps past midnight covers both sides', () => {
    expect(isWithinQuietHours(overnight, 'UTC', new Date('2026-06-15T22:00:00.000Z'))).toBe(true)
    expect(isWithinQuietHours(overnight, 'UTC', new Date('2026-06-15T03:00:00.000Z'))).toBe(true)
    expect(isWithinQuietHours(overnight, 'UTC', new Date('2026-06-15T12:00:00.000Z'))).toBe(false)
  })

  test('the window boundaries are start-inclusive and end-exclusive', () => {
    expect(isWithinQuietHours(daytime, 'UTC', new Date('2026-06-15T09:00:00.000Z'))).toBe(true)
    expect(isWithinQuietHours(daytime, 'UTC', new Date('2026-06-15T16:59:00.000Z'))).toBe(true)
    expect(isWithinQuietHours(daytime, 'UTC', new Date('2026-06-15T17:00:00.000Z'))).toBe(false)
  })

  test('an empty window is never quiet rather than always quiet', () => {
    expect(isWithinQuietHours({ startHour: 8, endHour: 8 }, 'UTC', new Date('2026-06-15T08:30:00.000Z'))).toBe(false)
  })

  test('is evaluated in the subject timezone, not the server one', () => {
    const at = new Date('2026-06-15T23:00:00.000Z') // 01:00 in Warsaw, 19:00 in New York
    expect(isWithinQuietHours(overnight, 'Europe/Warsaw', at)).toBe(true)
    expect(isWithinQuietHours(overnight, 'America/New_York', at)).toBe(false)
  })
})

describe('nextAllowedSendTime', () => {
  /**
   * Not every zone is a whole number of hours from UTC.
   *
   * India is +05:30, so the top of the UTC hour is :30 on the recipient's clock — and a "deferred until quiet
   * hours end at 08:00" send arrived at 08:30, every time, in every such zone. The two screens that print the
   * local hour agreed with each other while both disagreed with the clock the recipient was reading, which is
   * why it survived a review: nothing inconsistent was visible anywhere.
   */
  test('snaps to the top of the RECIPIENT\'s hour in a half-hour-offset zone', () => {
    const zone = 'Asia/Kolkata'
    const overnight = { startHour: 21, endHour: 8 }
    // 23:10 IST, inside the window.
    const deferred = nextAllowedSendTime(overnight, zone, new Date('2026-06-15T17:40:00.000Z'))
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false })
      .format(deferred)
    expect(local).toBe('08:00')
  })

  test('snaps an authored hour to the top of the recipient\'s hour too', () => {
    const zone = 'Australia/Adelaide'
    // 13:07 in Adelaide (+09:30) on a winter date, asking for the next 19:00 local.
    const at = new Date('2026-06-15T03:37:00.000Z')
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false })
      .format(nextOccurrenceOfHour(19, zone, at))
    expect(local).toBe('19:00')
  })
  const overnight = { startHour: 21, endHour: 8 }

  test('returns the same instant when sending is already allowed', () => {
    const at = new Date('2026-06-15T12:00:00.000Z')
    expect(nextAllowedSendTime(overnight, 'UTC', at)).toBe(at)
  })

  test('defers to the end of an overnight window', () => {
    const deferred = nextAllowedSendTime(overnight, 'UTC', new Date('2026-06-15T23:10:00.000Z'))
    expect(deferred.toISOString()).toBe('2026-06-16T08:00:00.000Z')
    expect(isWithinQuietHours(overnight, 'UTC', deferred)).toBe(false)
  })

  test('the deferred instant is always outside the window it was deferred from', () => {
    const at = new Date('2026-06-15T21:00:00.000Z')
    expect(isWithinQuietHours(overnight, 'Europe/Warsaw', at)).toBe(true)
    expect(isWithinQuietHours(overnight, 'Europe/Warsaw', nextAllowedSendTime(overnight, 'Europe/Warsaw', at))).toBe(false)
  })

  // Warsaw springs forward at 02:00 local on 2026-03-29, so the 02:00 hour does not exist that
  // day. Stepping forward and re-asking the gate cannot disagree with the gate; constructing a
  // local wall-clock time and converting back would.
  test('survives a daylight-saving jump', () => {
    const at = new Date('2026-03-28T23:30:00.000Z') // 00:30 local, inside quiet hours
    const deferred = nextAllowedSendTime(overnight, 'Europe/Warsaw', at)
    expect(isWithinQuietHours(overnight, 'Europe/Warsaw', deferred)).toBe(false)
    expect(localHourIn('Europe/Warsaw', deferred)).toBe(8)
  })
})

describe('nextOccurrenceOfHour', () => {
  const warsaw = 'Europe/Warsaw'

  test('returns the instant unchanged when it is already that hour', () => {
    // 07:30 UTC is 09:30 in Warsaw in September.
    const at = new Date('2026-09-28T07:30:00.000Z')
    expect(nextOccurrenceOfHour(9, warsaw, at)).toBe(at)
  })

  test('moves forward to the next occurrence and snaps to the top of the hour', () => {
    const at = new Date('2026-09-28T07:30:00.000Z')
    const next = nextOccurrenceOfHour(19, warsaw, at)
    expect(next.getTime()).toBeGreaterThan(at.getTime())
    expect(next.getUTCMinutes()).toBe(0)
  })

  test('never returns an instant in the past', () => {
    const at = new Date('2026-09-28T07:37:00.000Z')
    for (const hour of [0, 6, 9, 12, 18, 23]) {
      expect(nextOccurrenceOfHour(hour, warsaw, at).getTime()).toBeGreaterThanOrEqual(at.getTime())
    }
  })

  test('clamps an impossible hour rather than looping for two days', () => {
    const at = new Date('2026-09-28T07:30:00.000Z')
    expect(nextOccurrenceOfHour(99, warsaw, at).getTime()).toBeGreaterThanOrEqual(at.getTime())
    expect(nextOccurrenceOfHour(-5, warsaw, at).getTime()).toBeGreaterThanOrEqual(at.getTime())
  })

  // A timezone the runtime cannot resolve must not park a send forever.
  test('an unknown timezone falls back rather than deferring indefinitely', () => {
    const at = new Date('2026-09-28T07:30:00.000Z')
    expect(nextOccurrenceOfHour(9, 'Not/AZone', at).getTime()).toBeGreaterThanOrEqual(at.getTime())
  })
})

describe('recipient contact preferences', () => {
  const at = new Date('2026-09-29T12:00:00.000Z')

  test('a preference with no cap produces no cap', () => {
    expect(preferenceCap(null)).toBeNull()
    expect(preferenceCap({ maxPerWeek: null, pausedUntil: null })).toBeNull()
    // Zero or negative is not "unlimited" and not "never" — it is data nobody meant, so it is ignored.
    expect(preferenceCap({ maxPerWeek: 0, pausedUntil: null })).toBeNull()
    expect(preferenceCap({ maxPerWeek: -3, pausedUntil: null })).toBeNull()
  })

  test('a cap is expressed over a week, because that is what the customer chose', () => {
    expect(preferenceCap({ maxPerWeek: 3, pausedUntil: null })).toEqual({ maxMessages: 3, windowHours: PREFERENCE_WINDOW_HOURS })
    expect(PREFERENCE_WINDOW_HOURS).toBe(168)
  })

  test('a pause is only a pause until it expires', () => {
    expect(isPaused({ maxPerWeek: null, pausedUntil: new Date(at.getTime() + 1000) }, at)).toBe(true)
    expect(isPaused({ maxPerWeek: null, pausedUntil: new Date(at.getTime() - 1000) }, at)).toBe(false)
    expect(isPaused({ maxPerWeek: null, pausedUntil: null }, at)).toBe(false)
    expect(isPaused(null, at)).toBe(false)
  })

  test('the pause ceiling exists so a pause cannot quietly become an unsubscribe', () => {
    expect(MAX_PAUSE_DAYS).toBe(365)
  })

  test('the customer cap is evaluated by the same capping rule as the campaign one', () => {
    const cap = preferenceCap({ maxPerWeek: 2, pausedUntil: null })
    expect(isFrequencyCapped(1, cap)).toBe(false)
    expect(isFrequencyCapped(2, cap)).toBe(true)
  })
})
