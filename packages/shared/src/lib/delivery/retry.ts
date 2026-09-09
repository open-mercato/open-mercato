export type BackoffOptions = {
  baseDelayMs?: number
  maxJitterMs?: number
  factor?: number
}

/**
 * Exponential backoff with jitter for delivery-retry scheduling.
 *
 * `delay = baseDelayMs * factor^(attemptNumber - 1) + random(0, maxJitterMs)`
 *
 * `attemptNumber` is 1-based (the number of the attempt that just failed). The jitter spreads
 * simultaneous retries so a provider outage does not make every failed delivery re-fire at the
 * same instant (thundering herd). Reusable across delivery pipelines that need identical backoff
 * semantics instead of hand-rolling their own (currently the push delivery worker).
 */
export function calculateBackoffDelayMs(attemptNumber: number, options: BackoffOptions = {}): number {
  const baseDelayMs = options.baseDelayMs ?? 1000
  const maxJitterMs = options.maxJitterMs ?? 1000
  const factor = options.factor ?? 2
  const jitterMs = maxJitterMs > 0 ? Math.floor(Math.random() * maxJitterMs) : 0
  return baseDelayMs * Math.pow(factor, Math.max(attemptNumber - 1, 0)) + jitterMs
}
