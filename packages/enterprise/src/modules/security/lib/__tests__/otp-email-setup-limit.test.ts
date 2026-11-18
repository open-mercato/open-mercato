import { randomUUID } from 'node:crypto'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import type { MfaProviderRuntimeContext } from '../mfa-provider-interface'
import { OtpEmailProvider } from '../providers/OtpEmailProvider'

jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))

function context(limiter: RateLimiterService, userId = 'user-1', tenantId = 'tenant-1', ip = '203.0.113.1'): MfaProviderRuntimeContext {
  return {
    request: new Request('https://example.test/api/security/mfa/provider/otp_email', { headers: { 'x-forwarded-for': ip } }),
    commandContext: {
      auth: { sub: userId, tenantId },
      container: { resolve: () => limiter },
    } as never,
  }
}

function createLimiter() {
  return new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: randomUUID(), trustProxyDepth: 1 })
}

describe('Email OTP setup abuse limits with the real rate limiter and provider', () => {
  beforeEach(() => { jest.clearAllMocks() })

  test('limits one user even when destination and client IP change, before sending email', async () => {
    const provider = new OtpEmailProvider()
    const limiter = createLimiter()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await provider.setup('user-1', { email: `destination-${attempt}@example.test` }, context(limiter, 'user-1', 'tenant-1', `203.0.113.${attempt + 1}`))
    }
    await expect(provider.setup('user-1', { email: 'another@example.test' }, context(limiter))).rejects.toMatchObject({ status: 429 })
    expect(sendEmail).toHaveBeenCalledTimes(5)
  })

  test('bounds a destination across users while keeping tenants independent', async () => {
    const provider = new OtpEmailProvider()
    const limiter = createLimiter()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const userId = `user-${attempt}`
      await provider.setup(userId, { email: 'same@example.test' }, context(limiter, userId))
    }
    await expect(provider.setup('other-user', { email: 'SAME@example.test' }, context(limiter, 'other-user'))).rejects.toMatchObject({ status: 429 })
    await expect(provider.setup('other-user', { email: 'same@example.test' }, context(limiter, 'other-user', 'tenant-2'))).resolves.toHaveProperty('setupId')
    expect(sendEmail).toHaveBeenCalledTimes(6)
  })

  test('bounds the trusted IP across users and destinations', async () => {
    const provider = new OtpEmailProvider()
    const limiter = createLimiter()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const userId = `user-${attempt}`
      await provider.setup(userId, { email: `address-${attempt}@example.test` }, context(limiter, userId))
    }
    await expect(provider.setup('other-user', { email: 'another@example.test' }, context(limiter, 'other-user'))).rejects.toMatchObject({ status: 429 })
    expect(sendEmail).toHaveBeenCalledTimes(20)
  })

  test('fails closed without an available limiter and never sends an email', async () => {
    const limiter = createLimiter()
    jest.spyOn(limiter, 'consume').mockResolvedValue({ allowed: true, degraded: true, remainingPoints: 1, msBeforeNext: 0, consumedPoints: 0 })
    await expect(new OtpEmailProvider().setup('user-1', { email: 'owner@example.test' }, context(limiter))).rejects.toMatchObject({ status: 503 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  test('replaces a previous pending code for the same user', async () => {
    const previousMode = process.env.OM_TEST_MODE
    process.env.OM_TEST_MODE = 'true'
    try {
      const provider = new OtpEmailProvider()
      const first = await provider.setup('user-1', { email: 'first@example.test' })
      const second = await provider.setup('user-1', { email: 'second@example.test' })
      await expect(provider.confirmSetup('user-1', first.setupId, { code: first.clientData.code })).rejects.toThrow('not found')
      await expect(provider.confirmSetup('user-1', second.setupId, { code: second.clientData.code })).resolves.toMatchObject({ metadata: { email: 'second@example.test' } })
    } finally {
      if (previousMode === undefined) delete process.env.OM_TEST_MODE
      else process.env.OM_TEST_MODE = previousMode
    }
  })
})
