/** @jest-environment node */
import { NextResponse } from 'next/server'

const mockResolveTranslations = jest.fn()
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

const mockCheckRateLimit = jest.fn()
jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMIT_ERROR_KEY: 'api.errors.rateLimit',
  RATE_LIMIT_ERROR_FALLBACK: 'Too many requests. Please try again later.',
}))

const mockReadEndpointRateLimitConfig = jest.fn()
jest.mock('@open-mercato/shared/lib/ratelimit/config', () => ({
  readEndpointRateLimitConfig: (...args: unknown[]) => mockReadEndpointRateLimitConfig(...args),
}))

import { checkAiChatRateLimit } from '../rate-limit'

const config = { points: 30, duration: 60, keyPrefix: 'ai_chat' }

function makeRequest(headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/ai_assistant/ai/chat', { method: 'POST', headers })
}

function makeContainer(rateLimiterService: unknown, throwOnResolve = false) {
  return {
    resolve<T>(name: string): T {
      if (name !== 'rateLimiterService') throw new Error(`unexpected resolve("${name}")`)
      if (throwOnResolve) throw new Error('not registered')
      return rateLimiterService as T
    },
  }
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
  delete process.env.OM_TEST_MODE
  delete process.env.OM_TEST_AI_CHAT_RATE_LIMIT_MODE
  mockResolveTranslations.mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? '',
  })
  mockReadEndpointRateLimitConfig.mockReturnValue(config)
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('checkAiChatRateLimit', () => {
  it('fails open (returns null) when the limiter service is not registered', async () => {
    const result = await checkAiChatRateLimit({
      req: makeRequest(),
      container: makeContainer(null, true),
      userId: 'user-1',
      tenantId: 'tenant-1',
    })

    expect(result).toBeNull()
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('fails open (returns null) when the resolved service is null', async () => {
    const result = await checkAiChatRateLimit({
      req: makeRequest(),
      container: makeContainer(null),
      userId: 'user-1',
      tenantId: 'tenant-1',
    })

    expect(result).toBeNull()
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('returns null when the limiter allows the request, keyed on userId + tenantId', async () => {
    mockCheckRateLimit.mockResolvedValue(null)

    const result = await checkAiChatRateLimit({
      req: makeRequest(),
      container: makeContainer({}),
      userId: 'user-1',
      tenantId: 'tenant-1',
    })

    expect(result).toBeNull()
    expect(mockReadEndpointRateLimitConfig).toHaveBeenCalledWith('AI_CHAT', expect.any(Object))
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      config,
      'user-1:tenant-1',
      expect.any(String),
    )
  })

  it('returns the 429 response when the limiter denies the request', async () => {
    const denied = NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    mockCheckRateLimit.mockResolvedValue(denied)

    const result = await checkAiChatRateLimit({
      req: makeRequest(),
      container: makeContainer({}),
      userId: 'user-2',
      tenantId: 'tenant-2',
    })

    expect(result).toBe(denied)
  })

  it('uses a stable no-tenant key segment when tenantId is null/undefined', async () => {
    mockCheckRateLimit.mockResolvedValue(null)

    await checkAiChatRateLimit({
      req: makeRequest(),
      container: makeContainer({}),
      userId: 'user-3',
      tenantId: null,
    })

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      config,
      'user-3:no-tenant',
      expect.any(String),
    )
  })

  it('fails open (returns null) when the limiter throws', async () => {
    mockCheckRateLimit.mockRejectedValue(new Error('Redis connection lost'))

    const result = await checkAiChatRateLimit({
      req: makeRequest(),
      container: makeContainer({}),
      userId: 'user-1',
      tenantId: 'tenant-1',
    })

    expect(result).toBeNull()
  })

  describe('opt-in test mode', () => {
    beforeEach(() => {
      process.env.OM_TEST_MODE = '1'
      process.env.OM_TEST_AI_CHAT_RATE_LIMIT_MODE = 'opt-in'
    })

    it('skips the limiter when the opt-in header is absent', async () => {
      const result = await checkAiChatRateLimit({
        req: makeRequest(),
        container: makeContainer({}),
        userId: 'user-1',
        tenantId: 'tenant-1',
      })

      expect(result).toBeNull()
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
    })

    it('exercises the limiter when the opt-in header is set', async () => {
      mockCheckRateLimit.mockResolvedValue(null)

      await checkAiChatRateLimit({
        req: makeRequest({ 'x-om-test-rate-limit': 'on' }),
        container: makeContainer({}),
        userId: 'user-1',
        tenantId: 'tenant-1',
      })

      expect(mockCheckRateLimit).toHaveBeenCalledTimes(1)
    })
  })
})
