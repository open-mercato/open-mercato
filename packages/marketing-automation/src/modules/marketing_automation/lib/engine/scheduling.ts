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
