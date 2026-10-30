import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'

/**
 * Resolves the message to show when a timesheet timer start/stop request
 * fails. Prefers the localized message the server already returned (e.g. the
 * 409 "another timer is already running" reason, surfaced by the atomic
 * start-timer route) over a generic client-side fallback. Both the TimerBar
 * and the dashboard time-reporting widget use this so a rejected timer action
 * shows the specific server reason in the active locale instead of a hardcoded
 * English string (issue #3507).
 *
 * The server message is only trusted when the error originated from an HTTP
 * response (`raiseCrudError` attaches a numeric `status`); transport-level
 * failures (no response) fall back to the localized fallback so the user never
 * sees an untranslated network error string.
 */
export function resolveTimerActionError(err: unknown, fallback: string): string {
  const status = (err as { status?: unknown } | null)?.status
  if (typeof status !== 'number') return fallback
  const message = normalizeCrudServerError(err).message
  const trimmed = typeof message === 'string' ? message.trim() : ''
  return trimmed.length > 0 ? trimmed : fallback
}

/**
 * True when the write was refused because someone else holds the record lock on
 * the time entry (enterprise `record_locks`, pessimistic strategy: HTTP 423 with
 * `code: 'record_locked'`). Its server message is not localized, so callers show
 * their own message instead of `resolveTimerActionError`'s.
 */
export function isRecordLockedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const candidate = err as { status?: unknown; code?: unknown; body?: unknown }
  if (candidate.status === 423) return true
  if (candidate.code === 'record_locked') return true
  const body = candidate.body
  return Boolean(body && typeof body === 'object' && (body as { code?: unknown }).code === 'record_locked')
}

/** True for an HTTP 409: an optimistic-lock or record-lock conflict on the entry. */
export function isConflictError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { status?: unknown }).status === 409)
}
