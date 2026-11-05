/** @jest-environment node */

import { NextResponse } from 'next/server'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'

const mockCheckAuthRateLimit = jest.fn()

const signupIpConfig: RateLimitConfig = { points: 10, duration: 60, blockDuration: 120, keyPrefix: 'customer-signup-ip' }
const signupCompoundConfig: RateLimitConfig = { points: 3, duration: 60, blockDuration: 120, keyPrefix: 'customer-signup' }
const passwordResetIpConfig: RateLimitConfig = { points: 10, duration: 60, blockDuration: 120, keyPrefix: 'customer-password-reset-ip' }
const passwordResetCompoundConfig: RateLimitConfig = { points: 3, duration: 60, blockDuration: 120, keyPrefix: 'customer-password-reset' }
const magicLinkIpConfig: RateLimitConfig = { points: 10, duration: 60, blockDuration: 120, keyPrefix: 'customer-magic-link-ip' }
const magicLinkCompoundConfig: RateLimitConfig = { points: 3, duration: 60, blockDuration: 120, keyPrefix: 'customer-magic-link' }

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
  customerSignupIpRateLimitConfig: signupIpConfig,
  customerSignupRateLimitConfig: signupCompoundConfig,
  customerPasswordResetIpRateLimitConfig: passwordResetIpConfig,
  customerPasswordResetRateLimitConfig: passwordResetCompoundConfig,
  customerMagicLinkIpRateLimitConfig: magicLinkIpConfig,
  customerMagicLinkRateLimitConfig: magicLinkCompoundConfig,
}))

function makeJsonRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function rateLimitResponse(): NextResponse {
  return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
}

describe('customer account auth rate-limit identifiers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: rateLimitResponse(), compoundKey: null })
  })

  it('uses normalized email for signup compound rate limiting', async () => {
    const { POST } = await import('../signup')
    const req = makeJsonRequest('/api/signup', { email: '  Buyer@Example.COM  ' })

    await POST(req)

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith({
      req,
      ipConfig: signupIpConfig,
      compoundConfig: signupCompoundConfig,
      compoundIdentifier: 'buyer@example.com',
    })
  })

  it('uses normalized email for password reset compound rate limiting', async () => {
    const { POST } = await import('../password/reset-request')
    const req = makeJsonRequest('/api/password/reset-request', { email: '  Reset@Example.COM  ' })

    await POST(req)

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith({
      req,
      ipConfig: passwordResetIpConfig,
      compoundConfig: passwordResetCompoundConfig,
      compoundIdentifier: 'reset@example.com',
    })
  })

  it('uses normalized email for magic link compound rate limiting', async () => {
    const { POST } = await import('../magic-link/request')
    const req = makeJsonRequest('/api/magic-link/request', { email: '  Magic@Example.COM  ' })

    await POST(req)

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith({
      req,
      ipConfig: magicLinkIpConfig,
      compoundConfig: magicLinkCompoundConfig,
      compoundIdentifier: 'magic@example.com',
    })
  })

  it('falls back to IP-only rate limiting when a JSON body has no email string', async () => {
    const { POST } = await import('../password/reset-request')
    const req = makeJsonRequest('/api/password/reset-request', { email: null })

    await POST(req)

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith({
      req,
      ipConfig: passwordResetIpConfig,
      compoundConfig: passwordResetCompoundConfig,
      compoundIdentifier: undefined,
    })
  })
})
