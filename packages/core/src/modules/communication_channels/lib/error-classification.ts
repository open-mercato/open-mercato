/**
 * Classify provider errors for outbound retry decisions.
 *
 * Transient errors (network, 429, 5xx, timeout) → retry with backoff.
 * Permanent errors (4xx auth/validation/quota) → fail fast, no retry.
 *
 * Adapters can also throw classified errors directly by setting `transient: false`
 * on their thrown Error instance. This helper falls back to heuristics when an
 * adapter throws plain Error instances.
 */

export type ErrorClassification = {
  transient: boolean
  /** HTTP status if known; helps with backoff decisions (e.g., `Retry-After`) */
  status?: number
  /** Human-readable summary suitable for logging. */
  message: string
}

const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])

/**
 * Postgres SQLSTATEs that are transient (the operation can succeed on retry).
 * These reach the inbound-ingest classifier when a DB blip happens mid-ingest;
 * treating them as permanent would dead-letter the message AND advance the IMAP
 * cursor, silently losing inbound mail (the exact "cursor drift" failure the
 * email spec set out to prevent). Driver errors expose the SQLSTATE on `.code`.
 */
const TRANSIENT_PG_SQLSTATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (db starting up)
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
])

const TRANSIENT_CODE_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /socket hang up/i,
  /network timeout/i,
  /\btimed?\s*out\b/i,
  /service unavailable/i,
  /rate limit/i,
  /too many requests/i,
  /temporarily unavailable/i,
  /try again later/i,
  // imapflow surfaces these on TLS/socket-level drops that almost always
  // recover on the next attempt. Treating them as permanent kills the
  // channel after a single bad packet (regression observed during the demo:
  // a network hiccup put a freshly-connected mailbox into a non-recoverable
  // `error` state until the operator manually clicked "Retry").
  /unexpected close/i,
  /connection not available/i,
  /connection closed/i,
  /server closed connection/i,
  // Postgres transient failures surfaced as text by the ORM wrapper (the
  // SQLSTATE on `.code` is the primary signal; these catch wrapped errors that
  // only carry the message). See TRANSIENT_PG_SQLSTATES.
  /deadlock detected/i,
  /could not serialize access/i,
  /connection terminated/i,
  /too many clients already/i,
  /the database system is (starting up|shutting down|in recovery)/i,
]

export function classifyOutboundError(error: unknown): ErrorClassification {
  if (!error) {
    return { transient: false, message: 'Unknown error' }
  }

  if (error instanceof Error) {
    // Explicit hint from a classification-aware adapter.
    const explicit = (error as Error & { transient?: boolean; status?: number }).transient
    const status = (error as Error & { status?: number }).status
    if (explicit !== undefined) {
      return { transient: Boolean(explicit), status, message: error.message }
    }
    // Postgres driver errors expose the SQLSTATE on `.code`. A transient DB
    // failure during inbound ingest MUST classify as transient so the caller
    // aborts without advancing the cursor (no mail loss) rather than dead-lettering.
    const code = (error as Error & { code?: string }).code
    if (typeof code === 'string' && TRANSIENT_PG_SQLSTATES.has(code)) {
      return { transient: true, status, message: error.message }
    }
    if (typeof status === 'number') {
      return {
        transient: TRANSIENT_STATUS_CODES.has(status),
        status,
        message: error.message,
      }
    }
    const haystack = `${error.name} ${error.message}`
    const matchesPattern = TRANSIENT_CODE_PATTERNS.some((pattern) => pattern.test(haystack))
    return { transient: matchesPattern, message: error.message }
  }

  return { transient: false, message: String(error) }
}

/**
 * Decide whether a classified provider error means the channel's stored
 * credentials are no longer valid and the user must re-authorize.
 *
 * A 401, or an `invalid_grant` / `unauthorized` message, is unrecoverable by
 * retry: the access token is rejected and (for OAuth) the refresh token is
 * likely revoked too. Provider adapters may also surface the explicit
 * `requires_reauth` sentinel instead of a status — e.g. Gmail
 * `sendMessage` returns `{ status: 'failed', error: 'requires_reauth' }` on a
 * 401, which the outbound command rethrows as a status-less `Error`. Match that
 * sentinel too so the channel still flips to `requires_reauth`. Callers flip the
 * channel so the operator gets a clear signal. Kept identical to the inbound
 * poll path so inbound and outbound failures behave consistently.
 */
export function isReauthError(classification: ErrorClassification): boolean {
  return (
    classification.status === 401 ||
    /unauthorized|invalid_grant|requires_reauth/i.test(classification.message)
  )
}

/**
 * Compute exponential backoff delay (ms) for the given attempt number.
 *
 * Attempt 1 (= first retry) → 1s, attempt 2 → 2s, attempt 3 → 4s, ...
 * Capped at 60s. Plus a small jitter so concurrent failures don't all retry
 * simultaneously.
 */
export function computeBackoffMs(attemptNumber: number): number {
  const base = 1000 * Math.pow(2, Math.max(0, attemptNumber - 1))
  const capped = Math.min(base, 60_000)
  const jitter = Math.floor(Math.random() * 500)
  return capped + jitter
}
