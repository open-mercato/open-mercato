/**
 * Active PII redaction for telemetry text (Privacy section of the telemetry spec).
 *
 * Defense-in-depth over the don't-emit posture: callers are expected not to put
 * PII into errors/logs, but error messages and stack frames can still pick up an
 * email a layer down (e.g. `Error: no user for jan.kowalski@example.com`). This
 * scrubs the highest-signal identifier — email addresses — from any text that
 * ships to the backend, without touching opaque UUIDs/ids (which we keep).
 *
 * Deliberately conservative (emails only) to preserve debuggability; extend the
 * pattern set here if a new leak vector is found.
 */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export function redactPii(text: string): string {
  return text.replace(EMAIL_RE, '[redacted-email]')
}
