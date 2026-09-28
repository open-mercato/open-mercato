import {
  frequencyWindowStart,
  isFrequencyCapped,
  isWithinQuietHours,
  localHourIn,
  nextAllowedSendTime,
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
