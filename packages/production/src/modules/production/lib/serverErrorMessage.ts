/**
 * Extracts the server's already-translated business-rule message from an
 * action-route error (e.g. the cancel-blocked-with-partial-issue 409 body
 * `{ error: '...' }`, which is not an optimistic-lock conflict and is never
 * consumed by `surfaceRecordConflict`). Callers that `Object.assign(new
 * Error(...), { status, ...body })` on a non-ok response (mirrors
 * `mapCrudServerErrorToFormErrors`'s own `error`/`message` read order) land
 * the server's `error` string as a top-level property. Falls back to `null`
 * so callers can use their generic per-action message.
 *
 * Extracted here (task 4.3, DRY) so it is shared by both the order detail
 * page and the operator report form instead of being duplicated per page.
 */
export function extractServerErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const candidate = err as { error?: unknown; message?: unknown }
  if (typeof candidate.error === 'string' && candidate.error.trim()) return candidate.error
  if (
    typeof candidate.message === 'string' &&
    candidate.message.trim() &&
    !candidate.message.startsWith('[internal]')
  ) {
    return candidate.message
  }
  return null
}
