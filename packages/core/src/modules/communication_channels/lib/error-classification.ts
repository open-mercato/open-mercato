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
