import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import ExistingAccountEmail, { type ExistingAccountEmailCopy } from '../emails/ExistingAccountEmail'

/**
 * Best-effort ten-minute anti-spam window on the notice, backed by `rateLimiterService`.
 *
 * The duration matches the window `OnboardingService.createOrUpdateRequest` enforces on
 * verification emails, but the mechanism is deliberately weaker and must not be read as
 * equivalent: that window is a database column (`OnboardingRequest.lastEmailSentAt`), which is
 * authoritative, shared by every process and independent of the rate-limiting configuration.
 * This one is a limiter counter, so it is per-process under the default `memory` strategy
 * (`RATE_LIMIT_STRATEGY=redis` restores a shared window across replicas) and absent entirely
 * when rate limiting is switched off — `RateLimiterService.consume()` returns `allowed: true`
 * unconditionally while `RATE_LIMIT_ENABLED=false`. An instance exposing self-service
 * onboarding should therefore keep rate limiting enabled, or the address owner can be mailed
 * once per accepted submission instead of once per window.
 *
 * Failing closed when the limiter is unavailable is not an option here: skipping the send would
 * make the has-account branch answer 200 while the no-account branch still answers 502 on an
 * instance with broken mail delivery, which re-opens the enumeration oracle (#5505) the uniform
 * response shape closes. The window is a spam brake, never a disclosure control.
 */
const NOTICE_WINDOW_SECONDS = 10 * 60

const noticeRateLimitConfig: RateLimitConfig = {
  points: 1,
  duration: NOTICE_WINDOW_SECONDS,
  blockDuration: 0,
  keyPrefix: 'onboarding-existing-account',
}

export type ExistingAccountNoticeOutcome = 'sent' | 'throttled'

type RateLimiterLike = {
  consume: (key: string, config: RateLimitConfig) => Promise<{ allowed: boolean }>
  delete: (key: string, config: RateLimitConfig) => Promise<void>
}

type ContainerLike = { resolve: (name: string) => unknown }

export type SendExistingAccountNoticeArgs = {
  container: ContainerLike
  email: string
  loginUrl: string
  subject: string
  copy: ExistingAccountEmailCopy
}

/**
 * The limiter is registered only when rate limiting is configured, so an unregistered token
 * is a normal deployment state rather than an error. Resolved from the request container
 * instead of the core bootstrap singleton so this route keeps its lean module graph.
 *
 * Returning `null` means the notice is sent unthrottled — the fail-open half of the trade-off
 * documented on `NOTICE_WINDOW_SECONDS`, chosen because a skipped send would answer differently
 * from the no-account branch and re-open the enumeration oracle. The same reasoning is why
 * `consume()`'s `degraded` flag is not read: a degraded limiter still has to send.
 */
function resolveRateLimiter(container: ContainerLike): RateLimiterLike | null {
  try {
    const resolved = container.resolve('rateLimiterService')
    if (!resolved || typeof resolved !== 'object') return null
    const candidate = resolved as Partial<RateLimiterLike>
    if (typeof candidate.consume !== 'function' || typeof candidate.delete !== 'function') return null
    return candidate as RateLimiterLike
  } catch {
    return null
  }
}

/**
 * Tell the address owner — out of band — that someone tried to create a workspace with an
 * email that already has an account. The HTTP caller never learns which branch ran, so the
 * copy carries nothing the submitter supplied (no name, no organization name) and the mail
 * is the only place the existing account is acknowledged.
 *
 * Throws whatever `sendEmail` throws so the caller can answer with the same 502 body the
 * verification-email branch already returns.
 */
export async function sendExistingAccountNotice(
  args: SendExistingAccountNoticeArgs,
): Promise<ExistingAccountNoticeOutcome> {
  const rateLimiterService = resolveRateLimiter(args.container)
  const throttleKey = hashForLookup(args.email)

  if (rateLimiterService) {
    const consumed = await rateLimiterService.consume(throttleKey, noticeRateLimitConfig)
    if (!consumed.allowed) return 'throttled'
  }

  try {
    await sendEmail({
      to: args.email,
      subject: args.subject,
      react: ExistingAccountEmail({ loginUrl: args.loginUrl, copy: args.copy }),
    })
  } catch (error) {
    // Release the window the same way the verification branch clears `lastEmailSentAt` on a
    // failed send, so a retry behaves identically on both branches of a broken-mail instance.
    if (rateLimiterService) {
      await rateLimiterService.delete(throttleKey, noticeRateLimitConfig).catch(() => {})
    }
    throw error
  }

  return 'sent'
}
