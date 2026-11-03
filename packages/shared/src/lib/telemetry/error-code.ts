/**
 * The `module.reason` shape a failure fingerprint must have to be used as a
 * metric label (`data_sync.item_failed`, `queue.job_failed`).
 *
 * Enforced rather than documented because a `code` frequently originates outside
 * the framework — an adapter's `data.errorCode`, a third-party module's
 * `integrationLogService.write({ code })`. An interpolated `` `http_${status}_${url}` ``
 * would open one `om.errors` series per URL, and metric labels — unlike
 * attributes — never pass through redaction, so an interpolated customer email
 * would egress unredacted.
 */
export const ERROR_CODE_SHAPE = /^[a-z0-9_]+\.[a-z0-9_]+$/

/**
 * Narrow an untrusted value to a usable fingerprint, or to `fallback`.
 *
 * The fallback is a real code rather than `unknown` wherever a caller has one, so
 * grouping still works for a writer that supplies nothing or supplies rubbish.
 */
export function groupableCode(value: unknown, fallback: string): string
export function groupableCode(value: unknown, fallback?: undefined): string | undefined
export function groupableCode(value: unknown, fallback?: string): string | undefined {
  const code = typeof value === 'string' ? value.trim() : ''
  return ERROR_CODE_SHAPE.test(code) ? code : fallback
}
