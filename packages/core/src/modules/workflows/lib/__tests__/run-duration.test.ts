/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { formatDurationMs, formatElapsedSince, formatRunDuration, toMillis } from '../run-duration'

describe('formatDurationMs', () => {
  test('keeps milliseconds below a second — 8ms and 800ms are not the same step', () => {
    expect(formatDurationMs(8)).toBe('8ms')
    expect(formatDurationMs(800)).toBe('800ms')
  })

  test('shows a decimal for single-digit seconds and drops it above ten', () => {
    expect(formatDurationMs(2500)).toBe('2.5s')
    expect(formatDurationMs(42_000)).toBe('42s')
  })

  test('splits minutes, hours and days', () => {
    expect(formatDurationMs(90_000)).toBe('1m 30s')
    expect(formatDurationMs(3_600_000 + 120_000)).toBe('1h 2m')
    expect(formatDurationMs(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d 3h')
  })

  test('clamps a negative duration to zero rather than rendering "-5ms"', () => {
    expect(formatDurationMs(-5)).toBe('0ms')
  })
})

describe('formatRunDuration', () => {
  test('prefers the engine-measured value over the timestamp difference', () => {
    expect(
      formatRunDuration('2026-07-29T10:00:00.000Z', '2026-07-29T10:00:10.000Z', 120)
    ).toBe('120ms')
  })

  test('falls back to the timestamps when nothing was measured', () => {
    expect(formatRunDuration('2026-07-29T10:00:00.000Z', '2026-07-29T10:00:02.000Z')).toBe('2.0s')
  })

  test('returns null — not a misleading 0ms — when the run has not ended', () => {
    expect(formatRunDuration('2026-07-29T10:00:00.000Z', null)).toBeNull()
    expect(formatRunDuration(null, null)).toBeNull()
  })

  test('ignores an unparseable timestamp instead of rendering NaN', () => {
    expect(formatRunDuration('not-a-date', '2026-07-29T10:00:00.000Z')).toBeNull()
  })
})

describe('formatElapsedSince', () => {
  test('measures an unfinished run against now, so a stuck instance reads as stuck', () => {
    const now = new Date('2026-07-29T10:05:00.000Z').getTime()
    expect(formatElapsedSince('2026-07-29T10:00:00.000Z', null, now)).toBe('5m 0s')
  })

  test('uses the end timestamp when the run finished', () => {
    const now = new Date('2026-07-29T23:00:00.000Z').getTime()
    expect(formatElapsedSince('2026-07-29T10:00:00.000Z', '2026-07-29T10:00:30.000Z', now)).toBe('30s')
  })
})

describe('toMillis', () => {
  test('accepts Date and ISO string, rejects nullish and garbage', () => {
    expect(toMillis(new Date('2026-07-29T10:00:00.000Z'))).toBe(Date.parse('2026-07-29T10:00:00.000Z'))
    expect(toMillis('2026-07-29T10:00:00.000Z')).toBe(Date.parse('2026-07-29T10:00:00.000Z'))
    expect(toMillis(null)).toBeNull()
    expect(toMillis('nonsense')).toBeNull()
  })
})
