/** @jest-environment node */
/**
 * Pins the compliance classification behind the driver directory.
 *
 * The states are what an operator acts on, and two of them are subtle:
 *
 *   - a missing or unparseable date is `unknown`, never `valid` — a driver whose medical certificate
 *     has no recorded expiry is not provably compliant, and a green badge there is a compliance
 *     claim the data does not support;
 *   - the window boundary is inclusive, because "due in 30 days" is exactly the case the filter
 *     exists to surface.
 *
 * `resolveDriverCompliance` then takes the worse of the two dates: an expired licence must not be
 * masked by a medical certificate that is still valid.
 */
import { EXPIRY_WINDOW_DAYS, resolveDriverCompliance, resolveExpiryState } from '../expiry'

const NOW = new Date('2026-09-27T09:00:00.000Z')

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

describe('resolveExpiryState', () => {
  it('reports a past date as expired', () => {
    expect(resolveExpiryState(daysFromNow(-1), NOW)).toBe('expired')
    expect(resolveExpiryState(daysFromNow(-365), NOW)).toBe('expired')
  })

  it('reports a date inside the renewal window as expiring, boundary included', () => {
    expect(resolveExpiryState(daysFromNow(1), NOW)).toBe('expiring')
    expect(resolveExpiryState(daysFromNow(EXPIRY_WINDOW_DAYS), NOW)).toBe('expiring')
  })

  it('reports a date past the window as valid', () => {
    expect(resolveExpiryState(daysFromNow(EXPIRY_WINDOW_DAYS + 1), NOW)).toBe('valid')
  })

  it('treats a date whose expiry day has begun as expired, exactly as the fleet document table does', () => {
    // Date-only columns arrive as midnight UTC, so on the expiry day itself the parsed instant is
    // already in the past and the answer is "renew now" rather than "still fine".
    expect(resolveExpiryState('2026-09-27', NOW)).toBe('expired')
  })

  it('reports the exact instant of now as expiring, not as expired a moment early', () => {
    // The other side of the same boundary: an instant comparison says "not yet past", so the window
    // branch answers — the useful answer for a datetime-valued expiry.
    expect(resolveExpiryState(NOW.toISOString(), NOW)).toBe('expiring')
  })

  it('never claims validity for a missing or unparseable date', () => {
    expect(resolveExpiryState(null, NOW)).toBe('unknown')
    expect(resolveExpiryState(undefined, NOW)).toBe('unknown')
    expect(resolveExpiryState('', NOW)).toBe('unknown')
    expect(resolveExpiryState('not-a-date', NOW)).toBe('unknown')
  })

  it('accepts a Date as well as a string', () => {
    expect(resolveExpiryState(new Date(daysFromNow(-1)), NOW)).toBe('expired')
  })
})

describe('resolveDriverCompliance', () => {
  it('takes the worse of the two dates', () => {
    expect(resolveDriverCompliance(daysFromNow(-1), daysFromNow(365), NOW)).toBe('expired')
    expect(resolveDriverCompliance(daysFromNow(365), daysFromNow(10), NOW)).toBe('expiring')
  })

  it('does not let a missing medical date mask an expired licence', () => {
    expect(resolveDriverCompliance(daysFromNow(-1), null, NOW)).toBe('expired')
  })

  it('reports unknown only when both dates are unusable', () => {
    expect(resolveDriverCompliance(null, null, NOW)).toBe('unknown')
    expect(resolveDriverCompliance('', undefined, NOW)).toBe('unknown')
  })

  it('reports valid only when both dates are comfortably ahead', () => {
    expect(resolveDriverCompliance(daysFromNow(90), daysFromNow(200), NOW)).toBe('valid')
  })

  it('prefers expiring over unknown, so a missing date cannot hide a due renewal', () => {
    expect(resolveDriverCompliance(daysFromNow(5), null, NOW)).toBe('expiring')
  })
})
