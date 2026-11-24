import { asValue, createContainer } from 'awilix'
import { resolveLoginClientMeta } from '../loginClientMeta'

describe('resolveLoginClientMeta', () => {
  test.each([
    [undefined, null],
    [0, null],
    [1, '203.0.113.7'],
  ])('uses trusted proxy depth %s', (trustProxyDepth, expectedIp) => {
    const container = createContainer()
    if (trustProxyDepth !== undefined) {
      container.register('rateLimiterService', asValue({ trustProxyDepth }))
    }
    const request = new Request('https://example.test/api/auth/login', {
      headers: { 'x-forwarded-for': '192.0.2.1, 203.0.113.7', 'user-agent': 'a'.repeat(600) },
    })
    expect(resolveLoginClientMeta(request, container)).toEqual({
      ip: expectedIp,
      userAgent: 'a'.repeat(512),
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
  })
})
