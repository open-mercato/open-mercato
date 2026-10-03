/**
 * Filter helpers for the transport list routes.
 *
 * Both exist because of one mistake that is easy to make and impossible to notice: an object literal
 * that spreads two conditions which each carry `$or` keeps only the last one, so a request with a
 * search term *and* an expiry filter silently returns everything matching the expiry filter. The
 * symptom is a filter that "sometimes does nothing", which no test catches unless it is written the
 * way this helper forces it to be.
 */

/** Merges `$or`-shaped conditions into a filter object without dropping one. */
export function withOrConditions(
  base: Record<string, unknown>,
  orConditions: Array<Record<string, unknown>>,
): Record<string, unknown> {
  if (orConditions.length === 0) return base
  if (orConditions.length === 1) return { ...base, ...orConditions[0] }
  return { ...base, $and: orConditions }
}

/** The cut-off instant for a renewal window: now for `expired`, now + days for a "due soon" filter. */
export function expiryCutoff(
  selection: string | undefined,
  windows: Record<string, number>,
  now: Date = new Date(),
): Date | null {
  if (!selection) return null
  const days = windows[selection]
  if (days === undefined) return null
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}
