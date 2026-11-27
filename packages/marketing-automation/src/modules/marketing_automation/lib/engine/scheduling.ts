/**
 * Retry and claim timing.
 *
 * The backoff formula is carried over verbatim from the Magento original — 5, 10, 20, 40,
 * 80 minutes, then capped at 120 — so campaign behaviour under failure is unchanged. Only
 * the mechanism differs: the delay is handed to the queue instead of being polled by cron.
 */
export const RETRY_BASE_DELAY_MINUTES = 5
export const RETRY_MAX_DELAY_MINUTES = 120
export const MAX_ATTEMPTS = 5

/**
 * How long a claimed row may stay claimed before another worker may steal it.
 *
 * This exists because the claim and the completion are separate states here. A worker that
 * dies mid-action leaves a `claimed` row behind; without a lease it would be stranded
 * forever, which is exactly the failure mode of the original's claim-before-run stamp.
 */
export const CLAIM_LEASE_MINUTES = 15

/** `attempts` is the count INCLUDING the attempt that just failed, so it is 1-based here. */
export function computeRetryDelayMinutes(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(RETRY_BASE_DELAY_MINUTES * 2 ** exponent, RETRY_MAX_DELAY_MINUTES)
}

export function computeNextRetryAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + computeRetryDelayMinutes(attempts) * 60_000)
}

export function computeClaimLeaseCutoff(now: Date): Date {
  return new Date(now.getTime() - CLAIM_LEASE_MINUTES * 60_000)
}

export function hasExhaustedAttempts(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS
}

/**
 * A small, bounded spread added only to the QUEUE delay, never to `computeRetryDelayMinutes`'s own
 * exact minutes — those stay the verbatim Magento schedule the docblock above promises, and several
 * tests pin them to the exact value.
 *
 * Without this, every run a shared provider outage fails re-enqueues at EXACTLY the same future
 * instant as every other run that failed alongside it, and does so again at every later step of the
 * same backoff — the thundering-herd shape `calculateBackoffDelayMs` (used by the push delivery
 * worker) exists to avoid. Half a minute of jitter on top of a 5-to-120-minute delay is not a
 * schedule change anyone watching campaign timing would notice.
 */
const RETRY_QUEUE_JITTER_MAX_MS = 30_000

/** Applied once, at the point a retry delay is handed to the queue — see the constant above. */
export function withRetryJitter(delayMs: number): number {
  return delayMs + Math.floor(Math.random() * RETRY_QUEUE_JITTER_MAX_MS)
}
