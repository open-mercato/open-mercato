/** @jest-environment node */

const createRequestContainer = jest.fn()
const enforcePublicRateLimit = jest.fn(async () => null)
const resolveBySlug = jest.fn()
const beginAnonymous = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('../api/public/rate-limit', () => ({
  buildPublicRateLimitKey: (namespace: string, identifier: string) => `${namespace}:${identifier}`,
  enforcePublicRateLimit: (...args: unknown[]) => enforcePublicRateLimit(...args),
  getPublicClientIp: () => undefined,
}))

import { POST } from '../api/public/start/route'
import { NoopCaptchaVerifier } from '../services/captcha-verifier'

describe('Forms public start security gates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    enforcePublicRateLimit.mockResolvedValue(null)
    resolveBySlug.mockResolvedValue({
      distribution: {
        id: '00000000-0000-0000-0000-000000000001',
        requireCustomerAuth: false,
        settings: { captcha: true },
      },
    })
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'formsDistributionService') return { resolveBySlug, beginAnonymous }
        if (name === 'formsCaptchaVerifier') return new NoopCaptchaVerifier()
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    })
  })

  it('fails closed before creating rows when CAPTCHA is enabled without a verifier', async () => {
    const response = await POST(new Request('http://test/api/forms/public/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'public-form', captchaToken: 'unverified-token' }),
    }) as never)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'CAPTCHA_UNAVAILABLE' })
    expect(beginAnonymous).not.toHaveBeenCalled()
  })
})
