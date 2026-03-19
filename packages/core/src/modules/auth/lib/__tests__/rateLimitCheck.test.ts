/** @jest-environment node */
import { NextResponse } from 'next/server'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'

const mockGetCachedRateLimiterService = jest.fn()
jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: (...args: unknown[]) => mockGetCachedRateLimiterService(...args),
}))

const mockResolveTranslations = jest.fn()
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

const mockCheckRateLimit = jest.fn()
const mockGetClientIp = jest.fn()
jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
  RATE_LIMIT_ERROR_KEY: 'api.errors.rateLimit',
  RATE_LIMIT_ERROR_FALLBACK: 'Too many requests. Please try again later.',
}))

const mockComputeEmailHash = jest.fn()
jest.mock('@open-mercato/core/modules/auth/lib/emailHash', () => ({
  computeEmailHash: (...args: unknown[]) => mockComputeEmailHash(...args),
}))

import { checkAuthRateLimit, resetAuthRateLimit } from '@open-mercato/core/modules/auth/lib/rateLimitCheck'

const ipConfig: RateLimitConfig = { points: 20, duration: 60, blockDuration: 60, keyPrefix: 'login-ip' }
const compoundConfig: RateLimitConfig = { points: 5, duration: 60, blockDuration: 60, keyPrefix: 'login' }

function makeRequest(): Request {
  return new Request('http://localhost/api/auth/login', { method: 'POST' })
}

function makeFakeService(overrides?: Partial<{ trustProxyDepth: number; delete: jest.Mock }>) {
  return {
    trustProxyDepth: overrides?.trustProxyDepth ?? 1,
    delete: overrides?.delete ?? jest.fn(),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveTranslations.mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? '',
  })
  mockComputeEmailHash.mockImplementation((email: string) => `hash_${email}`)
})

describe('checkAuthRateLimit', () => {
  it('returns { error: null } when rate limiter service is null (fail-open)', async () => {
    mockGetCachedRateLimiterService.mockReturnValue(null)

    const result = await checkAuthRateLimit({
      req: makeRequest(),
      ipConfig,
      compoundConfig,
      compoundIdentifier: 'user@example.com',
    })

    expect(result.error).toBeNull()
    expect(result.compoundKey).toBeNull()
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('returns { error: null } when getClientIp returns null (fail-open)', async () => {
    mockGetCachedRateLimiterService.mockReturnValue(makeFakeService())
    mockGetClientIp.mockReturnValue(null)

    const result = await checkAuthRateLimit({
      req: makeRequest(),
      ipConfig,
      compoundConfig,
      compoundIdentifier: 'user@example.com',
    })

    expect(result.error).toBeNull()
    expect(result.compoundKey).toBeNull()
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('returns IP-only error when IP rate limit is exceeded', async () => {
    const errorResponse = NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    mockGetCachedRateLimiterService.mockReturnValue(makeFakeService())
    mockGetClientIp.mockReturnValue('1.2.3.4')
    mockCheckRateLimit.mockResolvedValue(errorResponse)

    const result = await checkAuthRateLimit({
      req: makeRequest(),
      ipConfig,
      compoundConfig,
      compoundIdentifier: 'user@example.com',
    })

    expect(result.error).toBe(errorResponse)
    expect(result.compoundKey).toBeNull()
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1)
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      ipConfig,
      '1.2.3.4',
      expect.any(String),
    )
  })

  it('returns compound error when compound rate limit is exceeded', async () => {
    const compoundError = NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    mockGetCachedRateLimiterService.mockReturnValue(makeFakeService())
    mockGetClientIp.mockReturnValue('1.2.3.4')
    mockCheckRateLimit
      .mockResolvedValueOnce(null) // IP layer passes
      .mockResolvedValueOnce(compoundError) // compound layer fails

    const result = await checkAuthRateLimit({
      req: makeRequest(),
      ipConfig,
      compoundConfig,
      compoundIdentifier: 'user@example.com',
    })

    expect(result.error).toBe(compoundError)
    expect(result.compoundKey).toBe('1.2.3.4:hash_user@example.com')
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(2)
  })

  it('returns { error: null, compoundKey } when both layers pass', async () => {
    mockGetCachedRateLimiterService.mockReturnValue(makeFakeService())
    mockGetClientIp.mockReturnValue('10.0.0.1')
    mockCheckRateLimit.mockResolvedValue(null)

    const result = await checkAuthRateLimit({
      req: makeRequest(),
      ipConfig,
      compoundConfig,
      compoundIdentifier: 'test@acme.com',
    })

    expect(result.error).toBeNull()
    expect(result.compoundKey).toBe('10.0.0.1:hash_test@acme.com')
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(2)
  })

  it('runs IP-only mode when no compoundConfig is provided', async () => {
    mockGetCachedRateLimiterService.mockReturnValue(makeFakeService())
    mockGetClientIp.mockReturnValue('1.2.3.4')
    mockCheckRateLimit.mockResolvedValue(null)

    const result = await checkAuthRateLimit({
      req: makeRequest(),
      ipConfig,
    })

    expect(result.error).toBeNull()
    expect(result.compoundKey).toBeNull()
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1)
    expect(mockComputeEmailHash).not.toHaveBeenCalled()
  })

  it('fails open when checkRateLimit throws an exception', async () => {
    mockGetCachedRateLimiterService.mockReturnValue(makeFakeService())
    mockGetClientIp.mockReturnValue('1.2.3.4')
    mockCheckRateLimit.mockRejectedValue(new Error('Redis connection lost'))

    const result = await checkAuthRateLimit({
      req: makeRequest(),
      ipConfig,
      compoundConfig,
      compoundIdentifier: 'user@example.com',
    })

    expect(result.error).toBeNull()
    expect(result.compoundKey).toBeNull()
  })

  it('uses computeEmailHash for the compound key, not raw email', async () => {
    mockGetCachedRateLimiterService.mockReturnValue(makeFakeService())
    mockGetClientIp.mockReturnValue('5.5.5.5')
    mockCheckRateLimit.mockResolvedValue(null)
    mockComputeEmailHash.mockReturnValue('sha256abc')

    const result = await checkAuthRateLimit({
      req: makeRequest(),
      ipConfig,
      compoundConfig,
      compoundIdentifier: 'sensitive@example.com',
    })

    expect(mockComputeEmailHash).toHaveBeenCalledWith('sensitive@example.com')
    expect(result.compoundKey).toBe('5.5.5.5:sha256abc')
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      compoundConfig,
      '5.5.5.5:sha256abc',
      expect.any(String),
    )
  })
})

describe('resetAuthRateLimit', () => {
  it('calls rateLimiterService.delete with correct args', async () => {
    const deleteFn = jest.fn().mockResolvedValue(undefined)
    mockGetCachedRateLimiterService.mockReturnValue(makeFakeService({ delete: deleteFn }))

    await resetAuthRateLimit('1.2.3.4:hash_user', compoundConfig)

    expect(deleteFn).toHaveBeenCalledWith('1.2.3.4:hash_user', compoundConfig)
  })

  it('is a no-op when service is null', async () => {
    mockGetCachedRateLimiterService.mockReturnValue(null)

    await expect(resetAuthRateLimit('key', compoundConfig)).resolves.toBeUndefined()
  })

  it('swallows exceptions and never throws', async () => {
    const deleteFn = jest.fn().mockRejectedValue(new Error('Redis down'))
    mockGetCachedRateLimiterService.mockReturnValue(makeFakeService({ delete: deleteFn }))

    await expect(resetAuthRateLimit('key', compoundConfig)).resolves.toBeUndefined()
  })
})
