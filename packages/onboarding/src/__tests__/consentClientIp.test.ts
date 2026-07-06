import { resolveConsentClientIp } from '@open-mercato/onboarding/modules/onboarding/lib/consentClientIp'

const getCachedRateLimiterService = jest.fn()

jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: () => getCachedRateLimiterService(),
}))

function makeRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/onboarding/onboarding/verify', { headers })
}

describe('resolveConsentClientIp', () => {
  beforeEach(() => {
    getCachedRateLimiterService.mockReset()
  })

  it('ignores a spoofed X-Forwarded-For when no proxy is trusted (trustProxyDepth=0)', () => {
    getCachedRateLimiterService.mockReturnValue({ trustProxyDepth: 0 })
    const req = makeRequest({ 'x-forwarded-for': '6.6.6.6' })
    expect(resolveConsentClientIp(req)).toBeNull()
  })

  it('honors the configured trust depth instead of a hardcoded 1 (trustProxyDepth=2)', () => {
    getCachedRateLimiterService.mockReturnValue({ trustProxyDepth: 2 })
    const req = makeRequest({ 'x-forwarded-for': 'client, proxy2, proxy1' })
    expect(resolveConsentClientIp(req)).toBe('proxy2')
  })

  it('records the trusted client IP for a single-proxy deployment (trustProxyDepth=1)', () => {
    getCachedRateLimiterService.mockReturnValue({ trustProxyDepth: 1 })
    const req = makeRequest({ 'x-forwarded-for': 'client, edge' })
    expect(resolveConsentClientIp(req)).toBe('edge')
  })

  it('falls back to X-Real-IP when X-Forwarded-For is untrusted', () => {
    getCachedRateLimiterService.mockReturnValue({ trustProxyDepth: 0 })
    const req = makeRequest({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '10.0.0.5' })
    expect(resolveConsentClientIp(req)).toBe('10.0.0.5')
  })

  it('returns null when the rate limiter service is unavailable', () => {
    getCachedRateLimiterService.mockReturnValue(null)
    const req = makeRequest({ 'x-forwarded-for': '6.6.6.6' })
    expect(resolveConsentClientIp(req)).toBeNull()
  })
})
