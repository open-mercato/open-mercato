import { RateLimiterService } from '../service'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK } from '../helpers'
import { readEndpointRateLimitConfig } from '../config'
import type { RateLimitConfig, RateLimitGlobalConfig } from '../types'

function createService(overrides: Partial<RateLimitGlobalConfig> = {}): RateLimiterService {
  return new RateLimiterService({
    enabled: true,
    strategy: 'memory',
    keyPrefix: 'test',
    trustProxyDepth: 1,
    ...overrides,
  })
}

const limitConfig: RateLimitConfig = {
  points: 2,
  duration: 60,
  keyPrefix: 'helpers-test',
}

describe('checkRateLimit', () => {
  let service: RateLimiterService

  afterEach(async () => {
    if (service) await service.destroy()
  })

  it('returns null when request is within the limit', async () => {
    service = createService()
    const result = await checkRateLimit(service, limitConfig, 'ip1', 'Rate limited')
    expect(result).toBeNull()
  })

  it('returns 429 NextResponse when rate limited', async () => {
    service = createService()
    await checkRateLimit(service, limitConfig, 'ip2', 'Rate limited')
    await checkRateLimit(service, limitConfig, 'ip2', 'Rate limited')

    const response = await checkRateLimit(service, limitConfig, 'ip2', 'Rate limited')
    expect(response).not.toBeNull()
    expect(response!.status).toBe(429)
  })

  it('includes error message in response body', async () => {
    service = createService()
    for (let i = 0; i < limitConfig.points; i++) {
      await checkRateLimit(service, limitConfig, 'ip3', 'Too many requests')
    }

    const response = await checkRateLimit(service, limitConfig, 'ip3', 'Too many requests')
    const body = await response!.json()
    expect(body.error).toBe('Too many requests')
  })

  it('includes Retry-After header', async () => {
    service = createService()
    for (let i = 0; i < limitConfig.points; i++) {
      await checkRateLimit(service, limitConfig, 'ip4', 'Rate limited')
    }

    const response = await checkRateLimit(service, limitConfig, 'ip4', 'Rate limited')
    const retryAfter = response!.headers.get('Retry-After')
    expect(retryAfter).toBeDefined()
    expect(Number(retryAfter)).toBeGreaterThan(0)
  })

  it('includes X-RateLimit-* headers', async () => {
    service = createService()
    for (let i = 0; i < limitConfig.points; i++) {
      await checkRateLimit(service, limitConfig, 'ip5', 'Rate limited')
    }

    const response = await checkRateLimit(service, limitConfig, 'ip5', 'Rate limited')
    expect(response!.headers.get('X-RateLimit-Limit')).toBe(String(limitConfig.points))
    expect(response!.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(Number(response!.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(0)
  })

  it('returns null when service is disabled', async () => {
    service = createService({ enabled: false })
    for (let i = 0; i < limitConfig.points + 5; i++) {
      const result = await checkRateLimit(service, limitConfig, 'ip6', 'Rate limited')
      expect(result).toBeNull()
    }
  })
})

describe('getClientIp', () => {
  it('ignores x-forwarded-for when trustProxyDepth is 0', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' },
    })
    expect(getClientIp(req, 0)).toBeNull()
  })

  it('ignores x-forwarded-for by default (trustProxyDepth defaults to 0)', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    })
    expect(getClientIp(req)).toBeNull()
  })

  it('falls back to x-real-ip when trustProxyDepth is 0', () => {
    const req = new Request('http://localhost', {
      headers: {
        'x-forwarded-for': 'spoofed-ip',
        'x-real-ip': '172.16.0.5',
      },
    })
    expect(getClientIp(req, 0)).toBe('172.16.0.5')
  })

  it('extracts last IP with trustProxyDepth=1 (single proxy)', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': 'client-ip, proxy-ip' },
    })
    expect(getClientIp(req, 1)).toBe('proxy-ip')
  })

  it('extracts client IP with trustProxyDepth=1 when single entry', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '192.168.1.1' },
    })
    expect(getClientIp(req, 1)).toBe('192.168.1.1')
  })

  it('extracts correct IP with trustProxyDepth=2 (two proxies)', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': 'spoofed, real-client, proxy1' },
    })
    expect(getClientIp(req, 2)).toBe('real-client')
  })

  it('falls back to first IP when fewer entries than trust depth', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '192.168.1.1' },
    })
    expect(getClientIp(req, 3)).toBe('192.168.1.1')
  })

  it('trims whitespace from x-forwarded-for entries', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '  10.0.0.1  ,  192.168.1.1  ' },
    })
    expect(getClientIp(req, 1)).toBe('192.168.1.1')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-real-ip': '172.16.0.5' },
    })
    expect(getClientIp(req, 1)).toBe('172.16.0.5')
  })

  it('returns null when no IP headers are present', () => {
    const req = new Request('http://localhost')
    expect(getClientIp(req)).toBeNull()
  })

  it('prefers x-forwarded-for over x-real-ip when trust depth > 0', () => {
    const req = new Request('http://localhost', {
      headers: {
        'x-forwarded-for': '10.0.0.1',
        'x-real-ip': '172.16.0.5',
      },
    })
    expect(getClientIp(req, 1)).toBe('10.0.0.1')
  })

  it('prevents IP spoofing by reading from the trusted end', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': 'attacker-spoofed-ip, real-client-ip' },
    })
    // With 1 trusted proxy, the last entry is from the proxy (real client IP it saw)
    expect(getClientIp(req, 1)).toBe('real-client-ip')
    // Attacker's spoofed IP is NOT returned
    expect(getClientIp(req, 1)).not.toBe('attacker-spoofed-ip')
  })
})

describe('readEndpointRateLimitConfig', () => {
  it('returns defaults when no env vars are set', () => {
    const config = readEndpointRateLimitConfig('TEST_EP', {
      points: 5, duration: 60, blockDuration: 30, keyPrefix: 'test-ep',
    })
    expect(config).toEqual({
      points: 5,
      duration: 60,
      blockDuration: 30,
      keyPrefix: 'test-ep',
    })
  })

  it('reads overrides from environment variables', () => {
    process.env.RATE_LIMIT_MY_EP_POINTS = '10'
    process.env.RATE_LIMIT_MY_EP_DURATION = '120'
    process.env.RATE_LIMIT_MY_EP_BLOCK_DURATION = '300'

    const config = readEndpointRateLimitConfig('MY_EP', {
      points: 5, duration: 60, blockDuration: 30, keyPrefix: 'my-ep',
    })
    expect(config).toEqual({
      points: 10,
      duration: 120,
      blockDuration: 300,
      keyPrefix: 'my-ep',
    })

    delete process.env.RATE_LIMIT_MY_EP_POINTS
    delete process.env.RATE_LIMIT_MY_EP_DURATION
    delete process.env.RATE_LIMIT_MY_EP_BLOCK_DURATION
  })

  it('falls back to defaults for non-numeric env values', () => {
    process.env.RATE_LIMIT_BAD_EP_POINTS = 'abc'
    process.env.RATE_LIMIT_BAD_EP_DURATION = ''

    const config = readEndpointRateLimitConfig('BAD_EP', {
      points: 5, duration: 60, keyPrefix: 'bad-ep',
    })
    expect(config.points).toBe(5)
    expect(config.duration).toBe(60)

    delete process.env.RATE_LIMIT_BAD_EP_POINTS
    delete process.env.RATE_LIMIT_BAD_EP_DURATION
  })

  it('handles missing blockDuration in defaults', () => {
    const config = readEndpointRateLimitConfig('NO_BLOCK', {
      points: 3, duration: 60, keyPrefix: 'no-block',
    })
    expect(config.blockDuration).toBeUndefined()
  })
})

describe('exported constants', () => {
  it('exports correct error key', () => {
    expect(RATE_LIMIT_ERROR_KEY).toBe('api.errors.rateLimit')
  })

  it('exports correct fallback message', () => {
    expect(RATE_LIMIT_ERROR_FALLBACK).toBe('Too many requests. Please try again later.')
  })
})
