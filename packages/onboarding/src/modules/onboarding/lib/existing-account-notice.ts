import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import ExistingAccountEmail, { type ExistingAccountEmailCopy } from '../emails/ExistingAccountEmail'

/**
 * Mirrors the ten-minute window `OnboardingService.createOrUpdateRequest` enforces on
 * verification emails. Both onboarding branches must throttle identically, otherwise the
 * throttled/not-throttled difference re-creates the account-enumeration oracle the uniform
 * response shape closes (#5505), and an address that already has an account could be
 * mail-bombed at the endpoint's per-IP rate instead of once per ten minutes.
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
