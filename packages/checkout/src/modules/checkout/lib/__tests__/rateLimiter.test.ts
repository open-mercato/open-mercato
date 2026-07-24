import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { buildCheckoutRateLimitKey } from '../rateLimiter'

function makeRateLimiter(trustProxyDepth: number): RateLimiterService {
  return { trustProxyDepth } as RateLimiterService
}

describe('buildCheckoutRateLimitKey', () => {
  it('ignores spoofed forwarding headers in direct mode and uses the bounded fallback', () => {
    const req = new Request('http://localhost', {
      headers: {
        'x-forwarded-for': 'attacker-controlled',
        'x-real-ip': 'attacker-controlled',
      },
    })

    expect(buildCheckoutRateLimitKey(req, makeRateLimiter(0), 'checkout-submit'))
      .toBe('checkout-submit:global')
  })

  it('uses the trusted right edge with one proxy', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': 'spoofed, 203.0.113.10' },
    })

    expect(buildCheckoutRateLimitKey(req, makeRateLimiter(1), 'checkout-password'))
      .toBe('checkout-password:203.0.113.10')
  })

  it('uses the configured trusted depth with multiple proxies', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': 'spoofed, 203.0.113.10, 192.0.2.5' },
    })

    expect(buildCheckoutRateLimitKey(req, makeRateLimiter(2), 'checkout-status'))
      .toBe('checkout-status:203.0.113.10')
  })

  it('uses the bounded fallback when the forwarded chain is undersized', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })

    expect(buildCheckoutRateLimitKey(req, makeRateLimiter(2), 'checkout-public-view'))
      .toBe('checkout-public-view:global')
  })
})
