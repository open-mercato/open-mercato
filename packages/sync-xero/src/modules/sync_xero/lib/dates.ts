const DOT_NET_DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/
const ISO_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/
const SECOND_MS = 1000

/**
 * Xero dates arrive in the .NET form `/Date(<ms>[+-hhmm])/`, where `<ms>` is already UTC, or as
 * ISO 8601 in the `*String` variants, which may omit the zone (then UTC). Anything else is null.
 */
export function parseXeroDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const dotNet = DOT_NET_DATE.exec(trimmed)
  if (dotNet) return new Date(Number(dotNet[1]))
  const parsed = Date.parse(ISO_WITHOUT_ZONE.test(trimmed) ? `${trimmed}Z` : trimmed)
  return Number.isNaN(parsed) ? null : new Date(parsed)
}

export function floorToSecond(value: Date): Date {
  return new Date(Math.floor(value.getTime() / SECOND_MS) * SECOND_MS)
}

/** The If-Modified-Since value for a keyset: one second before `value`, at second precision. */
export function keysetFilterBefore(value: Date): Date {
  return floorToSecond(new Date(value.getTime() - SECOND_MS))
}
