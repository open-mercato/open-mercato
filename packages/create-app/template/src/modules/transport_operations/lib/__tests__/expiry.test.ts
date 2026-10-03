/** @jest-environment node */
/**
 * Pins the licence-status boundaries.
 *
 * `unknown` is the state worth defending: a driver whose licence has no recorded date is not provably
 * allowed to drive, and a badge that reads it as valid is how an unlicensed driver stays on the roster.
 */
import { EXPIRY_WINDOW_DAYS, resolveExpiryState } from '../expiry'

const NOW = new Date('2026-09-27T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function iso(offsetDays: number): string {
  return new Date(NOW.getTime() + offsetDays * DAY_MS).toISOString()
}

describe('resolveExpiryState', () => {
  it('treats a missing or unparseable date as unknown rather than valid', () => {
    expect(resolveExpiryState(null, NOW)).toBe('unknown')
    expect(resolveExpiryState(undefined, NOW)).toBe('unknown')
    expect(resolveExpiryState('', NOW)).toBe('unknown')
    expect(resolveExpiryState('not-a-date', NOW)).toBe('unknown')
  })

  it('marks a date before now as expired', () => {
    expect(resolveExpiryState(iso(-1), NOW)).toBe('expired')
  })

  it('keeps a licence that expires this very instant inside the window, not past it', () => {
    // The boundary is deliberate and shared with the HR driver directory: a licence is valid *through*
    // its expiry instant, and the badge reads it as due rather than expired until the next millisecond.
    expect(resolveExpiryState(NOW.toISOString(), NOW)).toBe('expiring')
    expect(resolveExpiryState(new Date(NOW.getTime() - 1).toISOString(), NOW)).toBe('expired')
  })

  it('marks a date inside the window as expiring', () => {
    expect(resolveExpiryState(iso(1), NOW)).toBe('expiring')
    expect(resolveExpiryState(iso(EXPIRY_WINDOW_DAYS), NOW)).toBe('expiring')
  })

  it('marks a date beyond the window as valid', () => {
    expect(resolveExpiryState(iso(EXPIRY_WINDOW_DAYS + 1), NOW)).toBe('valid')
  })

  it('accepts a Date as readily as a string', () => {
    expect(resolveExpiryState(new Date(NOW.getTime() + DAY_MS), NOW)).toBe('expiring')
  })
})
