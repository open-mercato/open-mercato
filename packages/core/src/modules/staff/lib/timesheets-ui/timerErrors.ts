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
