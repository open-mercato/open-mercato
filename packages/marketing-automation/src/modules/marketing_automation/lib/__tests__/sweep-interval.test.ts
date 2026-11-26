import { carrySweepClocks, isSweepDue, isSweepIntervalValid, parseSweepIntervalMs, sweepClockKey } from '../sweep-interval'

describe('parseSweepIntervalMs', () => {
  test.each([
    ['30s', 30_000],
    ['5m', 300_000],
    ['6h', 21_600_000],
    ['1d', 86_400_000],
  ])('parses %s', (value, expected) => {
    expect(parseSweepIntervalMs(value)).toBe(expected)
  })

  test.each([['0m'], ['-5m'], ['1w'], ['soon'], [''], ['* * * * *']])('rejects %p', (value) => {
    expect(parseSweepIntervalMs(value)).toBeNull()
    expect(isSweepIntervalValid(value)).toBe(false)
  })
})

describe('isSweepDue', () => {
  const now = new Date('2026-09-28T12:00:00.000Z')

  test('a trigger that never swept is due', () => {
    expect(isSweepDue('1d', null, now)).toBe(true)
  })

  test('respects the declared interval', () => {
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60_000)
    expect(isSweepDue('1h', thirtyMinutesAgo, now)).toBe(false)
    expect(isSweepDue('15m', thirtyMinutesAgo, now)).toBe(true)
  })

  test('is due exactly at the boundary', () => {
    expect(isSweepDue('1h', new Date(now.getTime() - 3_600_000), now)).toBe(true)
  })

  // A value that got past save-time validation but cannot be parsed sweeps rather than never
  // running: silently disabling a campaign the author believes is live is the worse failure.
  test('an unparseable interval sweeps every tick', () => {
    expect(isSweepDue('* * * * *', new Date(now.getTime() - 1_000), now)).toBe(true)
  })
})

/**
 * The clock that has to survive a save.
 *
 * Triggers are written by delete-and-reinsert, so this is the only per-row state there is — and losing it
 * does not fail, it just sweeps again straight away.
 */
describe('carrySweepClocks', () => {
  const swept = new Date('2026-09-29T06:00:00.000Z')

  it('carries the clock for a schedule that is still there', () => {
    const clocks = carrySweepClocks([
      { kind: 'schedule', sweepSource: 'birthdays', scheduleValue: '1d', lastSweptAt: swept },
    ])
    expect(clocks.get(sweepClockKey('birthdays', '1d'))).toBe(swept)
  })

  /**
   * The regression: an author editing the copy of a daily campaign used to make it sweep again immediately,
   * because `isSweepDue` reads an absent clock as "due now".
   */
  it('keeps a same-day save from re-sweeping a daily campaign', () => {
    const clocks = carrySweepClocks([
      { kind: 'schedule', sweepSource: 'fulfilled_orders', scheduleValue: '1d', lastSweptAt: swept },
    ])
    const carried = clocks.get(sweepClockKey('fulfilled_orders', '1d')) ?? null
    expect(isSweepDue('1d', carried, new Date('2026-09-29T09:00:00.000Z'))).toBe(false)
    // And the next day it is due again, so nothing is stuck either.
    expect(isSweepDue('1d', carried, new Date('2026-09-30T07:00:00.000Z'))).toBe(true)
  })

  it('starts a fresh clock when the author changes the interval', () => {
    // "Daily" becoming "hourly" is a different schedule, and the author means it to take effect.
    const clocks = carrySweepClocks([
      { kind: 'schedule', sweepSource: 'birthdays', scheduleValue: '1d', lastSweptAt: swept },
    ])
    expect(clocks.get(sweepClockKey('birthdays', '1h'))).toBeUndefined()
  })

  it('starts a fresh clock when the author changes the source', () => {
    // The source is part of a schedule's identity; the same interval over different rows is different work.
    const clocks = carrySweepClocks([
      { kind: 'schedule', sweepSource: 'birthdays', scheduleValue: '1d', lastSweptAt: swept },
    ])
    expect(clocks.get(sweepClockKey('expiring_quotes', '1d'))).toBeUndefined()
  })

  it('ignores event triggers and rows that never swept', () => {
    const clocks = carrySweepClocks([
      { kind: 'event', sweepSource: null, scheduleValue: null, lastSweptAt: swept },
      { kind: 'schedule', sweepSource: 'birthdays', scheduleValue: '1d', lastSweptAt: null },
    ])
    expect(clocks.size).toBe(0)
  })
})
