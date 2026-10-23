/**
 * The deliverability circuit breaker.
 *
 * A sending domain's reputation is the one thing content quality cannot repair, and the usual way it is lost is
 * a campaign that keeps sending into a wall — a broken transport credential, a mailbox provider refusing
 * everything, a list of addresses that do not exist. This decides when to stop such a campaign.
 *
 * **What it measures, and what it cannot.** Bounce and complaint rates are the industry signals, and both
 * require feedback from the sending provider — webhooks the platform has no contract for yet. What IS available
 * is this module's own record of every attempt, so the breaker watches the FAILURE rate of attempted sends. That
 * catches the failure this is for; it will not catch a campaign that delivers successfully to people who then
 * mark it as spam. The roadmap records the provider-feedback contract as the follow-up.
 */

export type DeliverabilityWindow = {
  sent: number
  failed: number
}

/** Below this many attempts a rate is not a rate. Three failures out of three is a bad afternoon, not a trend. */
export const MINIMUM_ATTEMPTS = 20

/** Above this share of failures a campaign is not sending, it is being refused. */
export const FAILURE_RATE_THRESHOLD = 0.3

export type BreakerDecision =
  | { trip: true; failureRate: number; attempts: number }
  | { trip: false; reason: 'too_few_attempts' | 'within_tolerance' }

/**
 * Whether this campaign should be paused.
 *
 * Deliberately conservative in both directions: a small sample never trips it, and a campaign that is merely
 * unlucky is left alone — a guardrail that pauses working campaigns gets switched off, and then it is not a
 * guardrail.
 */
export function evaluateBreaker(
  window: DeliverabilityWindow,
  options: { minimumAttempts?: number; threshold?: number } = {},
): BreakerDecision {
  const attempts = window.sent + window.failed
  const minimum = options.minimumAttempts ?? MINIMUM_ATTEMPTS
  if (attempts < minimum) return { trip: false, reason: 'too_few_attempts' }

  const failureRate = window.failed / attempts
  if (failureRate < (options.threshold ?? FAILURE_RATE_THRESHOLD)) {
    return { trip: false, reason: 'within_tolerance' }
  }
  // Rounded to whole percent for the message a person reads; the decision used the exact value.
  return { trip: true, failureRate: Math.round(failureRate * 100) / 100, attempts }
}
