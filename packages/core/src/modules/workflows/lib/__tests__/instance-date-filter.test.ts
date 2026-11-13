/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { buildStartedAtRange } from '../instance-date-filter'

function expectOk(result: ReturnType<typeof buildStartedAtRange>) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
  return result.range
}

describe('buildStartedAtRange', () => {
  test('no bounds means no predicate at all', () => {
    expect(expectOk(buildStartedAtRange(null, null))).toBeNull()
    expect(expectOk(buildStartedAtRange('', ''))).toBeNull()
    expect(expectOk(buildStartedAtRange(undefined, undefined))).toBeNull()
  })

  test('a calendar day upper bound covers the WHOLE day', () => {
    // The filter bar emits calendar days. Taking `to` at midnight would exclude
    // everything that started later the same day — the filter would silently
    // answer the wrong question.
    const range = expectOk(buildStartedAtRange(null, '2026-07-29'))
    expect(range?.$lte?.toISOString()).toBe('2026-07-29T23:59:59.999Z')
  })

  test('a calendar day lower bound starts at midnight', () => {
    const range = expectOk(buildStartedAtRange('2026-07-29', null))
    expect(range?.$gte?.toISOString()).toBe('2026-07-29T00:00:00.000Z')
    expect(range?.$lte).toBeUndefined()
  })

  test('a full ISO timestamp is taken verbatim, not widened', () => {
    const range = expectOk(buildStartedAtRange('2026-07-29T14:30:00.000Z', '2026-07-29T15:00:00.000Z'))
    expect(range?.$gte?.toISOString()).toBe('2026-07-29T14:30:00.000Z')
    expect(range?.$lte?.toISOString()).toBe('2026-07-29T15:00:00.000Z')
  })

  test('a single-day range still matches that day', () => {
    const range = expectOk(buildStartedAtRange('2026-07-29', '2026-07-29'))
    expect(range?.$gte!.getTime()).toBeLessThan(range?.$lte!.getTime())
  })

  test('an unparseable bound is an error, never a dropped predicate', () => {
    // `new Date('garbage')` is an Invalid Date; a query built from one answers
    // nothing while looking like it answered something.
    const fromResult = buildStartedAtRange('garbage', null)
    expect(fromResult.ok).toBe(false)
    const toResult = buildStartedAtRange(null, '2026-13-45')
    expect(toResult.ok).toBe(false)
  })

  test('an inverted range is refused rather than silently returning nothing', () => {
    const result = buildStartedAtRange('2026-07-29', '2026-07-01')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/must not be after/i)
  })
})
