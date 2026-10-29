/**
 * Trims every trailing `/` from a base URL.
 *
 * Written as a scan rather than `replace(/\/+$/, '')` on purpose: the regex
 * form backtracks quadratically on a configured base URL that ends in a long
 * run of slashes, which CodeQL flags as a polynomial ReDoS. This walks the
 * string once from the end.
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end -= 1
  return value.slice(0, end)
}
