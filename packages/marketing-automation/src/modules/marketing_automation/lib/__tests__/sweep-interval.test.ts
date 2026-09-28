import { isSweepDue, isSweepIntervalValid, parseSweepIntervalMs } from '../sweep-interval'

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
