/**
 * Query-string parsing helpers shared by every `makeCrudRoute` handler and by
 * routes that read `URLSearchParams` directly.
 *
 * `Object.fromEntries(url.searchParams.entries())` keeps only the last value of
 * a repeated key, so `?status=win&status=loose` reached route schemas as
 * `'loose'` and every earlier selection was dropped before validation ran
 * (#5548). `buildQueryParams` groups repeats instead.
 */

import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'

export type QueryParamValue = string | string[]

/**
 * Group a query string into a plain object, preserving repeated keys.
 *
 * A key that occurs once keeps its raw string value — that is what today's
 * `z.string()` schemas expect and nothing about them has to change. A key that
 * occurs two or more times becomes the array of its values, which is what a
 * `z.array(z.string())` (or `z.union([z.string(), z.array(z.string())])`)
 * branch has always advertised.
 *
 * Values are never split on commas here: `?ids=a,b` and `?search=foo,bar` carry
 * comma semantics that belong to the individual route, not to the generic
 * parser. Use `readQueryParamList` / `toQueryValueList` where a field's contract
 * says a comma separates values.
 */
export function buildQueryParams(searchParams: URLSearchParams): Record<string, QueryParamValue> {
  const grouped = new Map<string, string[]>()
  searchParams.forEach((value, key) => {
    const existing = grouped.get(key)
    if (existing) existing.push(value)
    else grouped.set(key, [value])
  })
  const out: Record<string, QueryParamValue> = {}
  for (const [key, values] of grouped) {
    out[key] = values.length === 1 ? values[0] : values
  }
  return out
}

/**
 * Normalize a raw query value — a single string, an array of repeated values,
 * or nothing — into the list it stands for. Comma-separated and repeated forms
 * are equivalent here, so `?k=a,b&k=c` yields `['a', 'b', 'c']`.
 */
export function toQueryValueList(raw: unknown): string[] {
  const candidates = Array.isArray(raw) ? raw : [raw]
  const out: string[] = []
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    out.push(...parseCommaSeparatedList(candidate))
  }
  return out
}

/**
 * Read every value supplied for `key`, accepting both the repeated
 * (`?k=a&k=b`) and the comma-separated (`?k=a,b`) form.
 */
export function readQueryParamList(searchParams: URLSearchParams, key: string): string[] {
  return toQueryValueList(searchParams.getAll(key))
}
