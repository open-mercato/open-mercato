import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { consumeStartEmailBudget } from '../startEmailBudget'

describe('checkout start email budgets', () => {
  const scope = { email: 'Buyer@Example.com', linkId: 'link-1', tenantId: 'tenant-1', organizationId: 'org-1' }

  function containerFor(service: Pick<RateLimiterService, 'consume'>) {
    return { resolve: <T,>() => service as T }
  }

  function createLimiter() {
    return new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test', trustProxyDepth: 0 })
  }

  it('limits a normalized recipient across links and isolates tenant and organization budgets', async () => {
    const container = containerFor(createLimiter())
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await consumeStartEmailBudget(container, { ...scope, linkId: `link-${attempt}` })).toBe(true)
    }
    expect(await consumeStartEmailBudget(container, { ...scope, email: ' buyer@example.com ', linkId: 'link-4' })).toBe(false)
    expect(await consumeStartEmailBudget(container, { ...scope, tenantId: 'tenant-2' })).toBe(true)
    expect(await consumeStartEmailBudget(container, { ...scope, organizationId: 'org-2' })).toBe(true)
  })

  it('limits a link across different recipients and allows another link', async () => {
    const container = containerFor(createLimiter())
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(await consumeStartEmailBudget(container, { ...scope, email: `buyer${attempt}@example.com` })).toBe(true)
    }
    expect(await consumeStartEmailBudget(container, { ...scope, email: 'another@example.com' })).toBe(false)
    expect(await consumeStartEmailBudget(container, { ...scope, email: 'another@example.com', linkId: 'link-2' })).toBe(true)
  })

  it('does not put recipient PII into limiter keys', async () => {
    const consume = jest.fn().mockResolvedValue({ allowed: true })
    await consumeStartEmailBudget(containerFor({ consume }), scope)
    expect(consume.mock.calls[0][0]).toMatch(/^tenant-1:org-1:[a-f0-9]{64}$/)
    expect(JSON.stringify(consume.mock.calls)).not.toContain('example.com')
  })

  it('fails closed when the limiter is degraded or unavailable', async () => {
    await expect(consumeStartEmailBudget(containerFor({ consume: jest.fn().mockResolvedValue({ allowed: true, degraded: true }) }), scope))
      .rejects.toThrow('budget is unavailable')
    await expect(consumeStartEmailBudget(containerFor({ consume: jest.fn().mockRejectedValue(new Error('offline')) }), scope))
      .rejects.toThrow('offline')
  })
})
