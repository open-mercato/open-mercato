/**
 * Merges `$or`-shaped conditions into a filter object without dropping one.
 *
 * An object literal that spreads two conditions which each carry `$or` keeps
 * only the last one, so a request combining a search term with another
 * `$or`-shaped filter silently drops one of them — a bug that reads as a filter
 * that "sometimes does nothing".
 */
export function withOrConditions(
  base: Record<string, unknown>,
  orConditions: Array<Record<string, unknown>>,
): Record<string, unknown> {
  if (orConditions.length === 0) return base
  if (orConditions.length === 1) return { ...base, ...orConditions[0] }
  return { ...base, $and: orConditions }
}
