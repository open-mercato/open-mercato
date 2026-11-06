/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback: string) => fallback })),
}))

import { buildAssistedSellingRateLimitKey, enforceAssistedSellingBuyerRateLimit } from '../rateLimit'

const TOKEN = 'raw-guest-token-do-not-leak'

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('https://merchant.example/api/assisted_selling/storefront/thread', { method: 'POST', headers })
}

function makeContainer(limiter: unknown | null) {
  return {
    hasRegistration: (name: string) => name === 'rateLimiterService' && limiter !== null,
    resolve: (name: string) => {
      if (name === 'rateLimiterService' && limiter) return limiter
      throw new Error(`unknown ${name}`)
    },
  } as never
}

function makeLimiter(consume: jest.Mock, trustProxyDepth = 1) {
  return { trustProxyDepth, consume }
}

describe('buildAssistedSellingRateLimitKey', () => {
  it('never contains the raw token', () => {
    const key = buildAssistedSellingRateLimitKey('1.2.3.4', TOKEN)
    expect(key).not.toContain(TOKEN)
    expect(key.startsWith('1.2.3.4:t:')).toBe(true)
  })

  it('falls back to the token digest alone when the IP is unavailable', () => {
    const key = buildAssistedSellingRateLimitKey(null, TOKEN)
    expect(key.startsWith('t:')).toBe(true)
    expect(key).not.toContain(TOKEN)
  })

  it('uses a shared anonymous bucket when neither is available', () => {
    expect(buildAssistedSellingRateLimitKey(null, null)).toBe('anonymous')
  })
})

describe('enforceAssistedSellingBuyerRateLimit', () => {
  it('passes only a digest of the token to the limiter', async () => {
    const consume = jest.fn(async () => ({ allowed: true, degraded: false, remainingPoints: 5, msBeforeNext: 0 }))
    await enforceAssistedSellingBuyerRateLimit(makeContainer(makeLimiter(consume)), makeRequest({ 'x-forwarded-for': '9.9.9.9' }), 'message', TOKEN)
    expect(consume).toHaveBeenCalledTimes(1)
    const calls = consume.mock.calls as unknown as Array<[string]>
    expect(calls[0][0]).not.toContain(TOKEN)
  })

  it('still limits (by token digest) when the client IP is unavailable', async () => {
    const consume = jest.fn(async () => ({ allowed: true, degraded: false, remainingPoints: 5, msBeforeNext: 0 }))
    await enforceAssistedSellingBuyerRateLimit(makeContainer(makeLimiter(consume, 0)), makeRequest(), 'open', TOKEN)
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('POST buckets fail closed with 503 when no limiter is registered', async () => {
    const response = await enforceAssistedSellingBuyerRateLimit(makeContainer(null), makeRequest(), 'message', TOKEN)
    expect(response?.status).toBe(503)
    const open = await enforceAssistedSellingBuyerRateLimit(makeContainer(null), makeRequest(), 'open', TOKEN)
    expect(open?.status).toBe(503)
  })

  it('POST buckets fail closed with 503 when the backing store is degraded', async () => {
    const consume = jest.fn(async () => ({ allowed: true, degraded: true, remainingPoints: 0, msBeforeNext: 0 }))
    const response = await enforceAssistedSellingBuyerRateLimit(makeContainer(makeLimiter(consume)), makeRequest({ 'x-forwarded-for': '9.9.9.9' }), 'message', TOKEN)
    expect(response?.status).toBe(503)
  })

  it('POST buckets fail closed with 503 when the limiter throws', async () => {
    const consume = jest.fn(async () => {
      throw new Error('redis down')
    })
    const response = await enforceAssistedSellingBuyerRateLimit(makeContainer(makeLimiter(consume)), makeRequest(), 'open', TOKEN)
    expect(response?.status).toBe(503)
  })

  it('read buckets stay fail-open when no limiter is registered', async () => {
    const response = await enforceAssistedSellingBuyerRateLimit(makeContainer(null), makeRequest(), 'read', TOKEN)
    expect(response).toBeNull()
  })
})

describe('enforceAssistedSellingBuyerRateLimit client IP trust', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn(), child: jest.fn() }
  const reportError = jest.fn()

  function loadIsolated() {
    let loaded: typeof import('../rateLimit') | null = null
    jest.isolateModules(() => {
      logger.child.mockReturnValue(logger)
      jest.doMock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => logger }))
      jest.doMock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError }) }))
      loaded = require('../rateLimit')
    })
    return loaded as unknown as typeof import('../rateLimit')
  }

  const allowed = () => jest.fn(async () => ({ allowed: true, degraded: false, remainingPoints: 5, msBeforeNext: 0 }))

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    Object.assign(process.env, { NODE_ENV: originalNodeEnv })
  })

  it('keys on the proxy-derived client IP when the proxy depth is usable and does not flag anything', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' })
    const mod = loadIsolated()
    const consume = allowed()
    await mod.enforceAssistedSellingBuyerRateLimit(makeContainer(makeLimiter(consume, 1)), makeRequest({ 'x-forwarded-for': '203.0.113.7' }), 'message', TOKEN)
    const calls = consume.mock.calls as unknown as Array<[string]>
    expect(calls[0][0]).toContain('203.0.113.7:t:')
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('ignores spoofed forwarded headers at the default proxy depth and flags the unusable configuration once in production', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' })
    const mod = loadIsolated()
    const consume = allowed()
    const container = makeContainer(makeLimiter(consume, 0))
    await mod.enforceAssistedSellingBuyerRateLimit(container, makeRequest({ 'x-forwarded-for': '203.0.113.7' }), 'message', TOKEN)
    await mod.enforceAssistedSellingBuyerRateLimit(container, makeRequest({ 'x-forwarded-for': '203.0.113.8' }), 'message', TOKEN)
    const calls = consume.mock.calls as unknown as Array<[string]>
    expect(calls[0][0].startsWith('t:')).toBe(true)
    expect(calls[0][0]).toBe(calls[1][0])
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(logger.error.mock.calls[0][0])).not.toContain('inactive')
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('flags a proxy depth longer than the forwarded chain as unusable', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' })
    const mod = loadIsolated()
    const consume = allowed()
    await mod.enforceAssistedSellingBuyerRateLimit(makeContainer(makeLimiter(consume, 3)), makeRequest({ 'x-forwarded-for': '203.0.113.7' }), 'open', TOKEN)
    const calls = consume.mock.calls as unknown as Array<[string]>
    expect(calls[0][0].startsWith('t:')).toBe(true)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('only warns outside production', async () => {
    Object.assign(process.env, { NODE_ENV: 'test' })
    const mod = loadIsolated()
    await mod.enforceAssistedSellingBuyerRateLimit(makeContainer(makeLimiter(allowed(), 0)), makeRequest(), 'read', TOKEN)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.error).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
  })
})
