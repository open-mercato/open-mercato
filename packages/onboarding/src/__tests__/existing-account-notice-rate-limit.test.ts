const sendEmail = jest.fn()

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { sendExistingAccountNotice } from '../modules/onboarding/lib/existing-account-notice'

const VICTIM_EMAIL = 'victim@example.com'

const copy = {
  preview: 'preview',
  heading: 'heading',
  greeting: 'greeting',
  body: 'body',
  cta: 'cta',
  ignore: 'ignore',
  footer: 'footer',
}

function containerFor(limiter: RateLimiterService | null) {
  return {
    resolve: (name: string) => {
      if (name !== 'rateLimiterService') throw new Error(`[internal] unexpected resolve(${name})`)
      if (!limiter) throw new Error('[internal] rateLimiterService is not registered')
      return limiter
    },
  }
}

function notice(limiter: RateLimiterService | null, email: string) {
  return sendExistingAccountNotice({
    container: containerFor(limiter),
    email,
    loginUrl: 'https://app.example.com/login',
    subject: 'About your Open Mercato account',
    copy,
  })
}

function limiterService(enabled: boolean): RateLimiterService {
  return new RateLimiterService({
    enabled,
    strategy: 'memory',
    keyPrefix: 'test',
    trustProxyDepth: 0,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  sendEmail.mockResolvedValue(undefined)
})

/**
 * The parity suite asserts the notice throttle against a mocked limiter, which cannot observe
 * what the real `RateLimiterService` does with the config it is handed. These cases exercise the
 * real service so the window — and the documented hole in it — are pinned by the suite rather
 * than by a reviewer's manual trace.
 */
describe('existing-account notice against the real RateLimiterService', () => {
  it('sends once per address per window when rate limiting is enabled', async () => {
    const limiter = limiterService(true)

    await expect(notice(limiter, VICTIM_EMAIL)).resolves.toBe('sent')
    await expect(notice(limiter, VICTIM_EMAIL)).resolves.toBe('throttled')

    expect(sendEmail).toHaveBeenCalledTimes(1)
    await limiter.destroy()
  })

  it('throttles a case-variant address through the same window', async () => {
    const limiter = limiterService(true)

    await expect(notice(limiter, VICTIM_EMAIL)).resolves.toBe('sent')
    await expect(notice(limiter, ' VICTIM@Example.COM ')).resolves.toBe('throttled')

    expect(hashForLookup(' VICTIM@Example.COM ')).toBe(hashForLookup(VICTIM_EMAIL))
    expect(sendEmail).toHaveBeenCalledTimes(1)
    await limiter.destroy()
  })

  it('releases the window on a failed send so the next attempt still mails the owner', async () => {
    const limiter = limiterService(true)
    sendEmail.mockRejectedValueOnce(new Error('smtp down'))

    await expect(notice(limiter, VICTIM_EMAIL)).rejects.toThrow('smtp down')
    await expect(notice(limiter, VICTIM_EMAIL)).resolves.toBe('sent')

    expect(sendEmail).toHaveBeenCalledTimes(2)
    await limiter.destroy()
  })

  it('does not share a window with the endpoint\'s own per-IP limiter', async () => {
    const limiter = limiterService(true)
    const endpointConfig: RateLimitConfig = {
      points: 10,
      duration: 60,
      blockDuration: 60,
      keyPrefix: 'onboarding',
    }

    await limiter.consume(hashForLookup(VICTIM_EMAIL), endpointConfig)
    await expect(notice(limiter, VICTIM_EMAIL)).resolves.toBe('sent')

    expect(sendEmail).toHaveBeenCalledTimes(1)
    await limiter.destroy()
  })

  /**
   * Deliberate, documented gap rather than an oversight: with rate limiting switched off the
   * window disappears, because failing closed would answer differently from the no-account
   * branch and re-open the enumeration oracle (#5505). See `existing-account-notice.ts`.
   */
  it('sends unthrottled when rate limiting is disabled', async () => {
    const limiter = limiterService(false)

    await expect(notice(limiter, VICTIM_EMAIL)).resolves.toBe('sent')
    await expect(notice(limiter, VICTIM_EMAIL)).resolves.toBe('sent')

    expect(sendEmail).toHaveBeenCalledTimes(2)
    await limiter.destroy()
  })

  it('sends unthrottled when no limiter is registered at all', async () => {
    await expect(notice(null, VICTIM_EMAIL)).resolves.toBe('sent')
    await expect(notice(null, VICTIM_EMAIL)).resolves.toBe('sent')

    expect(sendEmail).toHaveBeenCalledTimes(2)
  })
})
