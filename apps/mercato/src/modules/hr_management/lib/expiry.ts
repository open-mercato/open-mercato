/**
 * Compliance dates for HR records, as a pure function so the list, the form and the API agree.
 *
 * A driver is compliant only when the licence *and* the medical certificate are valid, so "expiring"
 * has to be decided per date and then combined by the caller; keeping one definition here is what
 * stops the badge in the table and the filter in the query from drifting apart.
 */

/** How far ahead a renewal counts as due. Matches the dashboard's document-expiry window. */
export const EXPIRY_WINDOW_DAYS = 30

export type ExpiryState = 'expired' | 'expiring' | 'valid' | 'unknown'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Classifies a date against `now`.
 *
 * `unknown` is its own state rather than "valid": a driver whose certificate has no recorded date is
 * not provably compliant, and silently showing a green badge for missing data is the failure mode
 * this state exists to prevent. An unparseable value is treated the same way.
 */
export function resolveExpiryState(value: string | Date | null | undefined, now: Date = new Date()): ExpiryState {
  if (!value) return 'unknown'
  const expiry = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(expiry.getTime())) return 'unknown'
  const time = expiry.getTime()
  if (time < now.getTime()) return 'expired'
  return time <= now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS ? 'expiring' : 'valid'
}

/**
 * The state of the driver's credentials as a whole: the worse of the two dates wins, and a missing
 * medical date does not mask an expired licence.
 */
export function resolveDriverCompliance(
  licenceExpiry: string | Date | null | undefined,
  medicalExpiry: string | Date | null | undefined,
  now: Date = new Date(),
): ExpiryState {
  const order: ExpiryState[] = ['expired', 'expiring', 'valid', 'unknown']
  const states = [resolveExpiryState(licenceExpiry, now), resolveExpiryState(medicalExpiry, now)]
  return order.find((state) => states.includes(state)) ?? 'unknown'
}
