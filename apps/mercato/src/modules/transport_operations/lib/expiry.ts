/**
 * Driver licence dates for the transport module, as a pure function so the list badge, the form and
 * the API filter agree on what "expiring" means.
 *
 * `unknown` is its own state rather than "valid": a driver whose licence has no recorded date is not
 * provably allowed to drive, and showing a green badge for missing data is the failure mode this
 * state exists to prevent.
 */

/** How far ahead a renewal counts as due. Matches the dashboard's expiring-licence window. */
export const EXPIRY_WINDOW_DAYS = 30

export type ExpiryState = 'expired' | 'expiring' | 'valid' | 'unknown'

const DAY_MS = 24 * 60 * 60 * 1000

/** Classifies a date against `now`; an absent or unparseable value is `unknown`. */
export function resolveExpiryState(value: string | Date | null | undefined, now: Date = new Date()): ExpiryState {
  if (!value) return 'unknown'
  const expiry = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(expiry.getTime())) return 'unknown'
  const time = expiry.getTime()
  if (time < now.getTime()) return 'expired'
  return time <= now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS ? 'expiring' : 'valid'
}
