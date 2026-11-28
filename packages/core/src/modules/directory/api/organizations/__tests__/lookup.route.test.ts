/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const find = jest.fn()
const resolveByHostname = jest.fn()

let domainMappingServiceRegistered = true

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return { find }
    if (name === 'domainMappingService') {
      if (!domainMappingServiceRegistered) return undefined
      return { resolveByHostname }
    }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

const consume = jest.fn(async () => ({ allowed: true, msBeforeNext: 0, remainingPoints: 59 }))
let rateLimiterService: unknown = { trustProxyDepth: 1, consume }

jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: () => rateLimiterService,
}))

import { GET } from '../../get/organizations/lookup'

function makeRequest(slug: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/directory/organizations/lookup?slug=${encodeURIComponent(slug)}`, {
    headers: { 'x-forwarded-for': '203.0.113.10', ...headers },
  })
}

function makeOrganization() {
  return { id: organizationId, name: 'Acme', slug: 'acme', tenant: { id: tenantId } }
}

describe('GET /api/directory/organizations/lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    domainMappingServiceRegistered = true
    rateLimiterService = { trustProxyDepth: 1, consume }
    consume.mockResolvedValue({ allowed: true, msBeforeNext: 0, remainingPoints: 59 })
    find.mockResolvedValue([makeOrganization()])
    resolveByHostname.mockResolvedValue(null)
  })

  it('scopes the lookup to the organization and tenant mapped to an active custom domain', async () => {
    resolveByHostname.mockResolvedValue({ tenantId, organizationId, status: 'active' })

    const res = await GET(makeRequest('acme', { host: 'shop.acme.com' }))

    expect(res.status).toBe(200)
    expect(resolveByHostname).toHaveBeenCalledWith('shop.acme.com')
    const [, filter] = find.mock.calls[0]
    expect(filter).toMatchObject({ id: organizationId, deletedAt: null, tenant: tenantId })
    await expect(res.json()).resolves.toEqual({
      ok: true,
      organization: { id: organizationId, name: 'Acme', slug: 'acme' },
    })
  })

  it('does not leak another tenant org when the custom-domain host owns no such slug', async () => {
    resolveByHostname.mockResolvedValue({ tenantId, organizationId, status: 'active' })
    find.mockResolvedValue([])

    const res = await GET(makeRequest('competitor', { host: 'shop.acme.com' }))

    expect(res.status).toBe(404)
    expect(find).toHaveBeenCalledTimes(1)
    const [, filter] = find.mock.calls[0]
    expect(filter).toMatchObject({ id: organizationId, tenant: tenantId })
  })

  it('resolves a unique undeleted slug on the platform domain', async () => {
    resolveByHostname.mockResolvedValue(null)

    const res = await GET(makeRequest('acme', { host: 'app.openmercato.com' }))

    expect(res.status).toBe(200)
    const [, filter, options] = find.mock.calls[0]
    expect(filter).not.toHaveProperty('tenant')
    expect(options).toEqual({ limit: 2 })
  })

  it('returns 404 when the platform organization resolver has an ambiguous result', async () => {
    find.mockResolvedValue([makeOrganization(), { ...makeOrganization(), id: 'different-org' }])

    const res = await GET(makeRequest('acme'))

    expect(res.status).toBe(404)
  })

  it('keeps the request scoped when the domain service fails', async () => {
    resolveByHostname.mockRejectedValue(new Error('[internal] domain service unavailable'))

    await expect(GET(makeRequest('acme', { host: 'shop.acme.com' }))).rejects.toThrow('domain service unavailable')
    expect(find).not.toHaveBeenCalled()
  })

  it('ignores an inactive domain mapping and keeps the global resolution', async () => {
    resolveByHostname.mockResolvedValue({ tenantId, organizationId, status: 'pending' })

    const res = await GET(makeRequest('acme', { host: 'pending.acme.com' }))

    expect(res.status).toBe(200)
    const [, filter] = find.mock.calls[0]
    expect(filter).not.toHaveProperty('tenant')
  })

  it('degrades to the global resolution when the domain-mapping peer is absent', async () => {
    domainMappingServiceRegistered = false

    const res = await GET(makeRequest('acme', { host: 'shop.acme.com' }))

    expect(res.status).toBe(200)
    const [, filter] = find.mock.calls[0]
    expect(filter).not.toHaveProperty('tenant')
  })

  it('rate limits slug enumeration per IP before hitting the database', async () => {
    consume.mockResolvedValue({ allowed: false, msBeforeNext: 30_000, remainingPoints: 0 })

    const res = await GET(makeRequest('acme'))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(find).not.toHaveBeenCalled()
  })

  it('rejects an empty slug', async () => {
    const res = await GET(makeRequest(''))

    expect(res.status).toBe(400)
    expect(find).not.toHaveBeenCalled()
  })

  it('rate limits invalid slugs too, so the limiter cannot be bypassed with junk input', async () => {
    consume.mockResolvedValue({ allowed: false, msBeforeNext: 30_000, remainingPoints: 0 })

    const res = await GET(makeRequest(''))

    expect(res.status).toBe(429)
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('caps at 60 lookups per minute per IP, so a workforce behind one NAT egress IP is not throttled', async () => {
    await GET(makeRequest('acme'))

    const [, config] = consume.mock.calls[0]
    expect(config).toMatchObject({ points: 60, duration: 60 })
  })

  it('fails open when the limiter throws, so a limiter outage cannot break the portal bootstrap', async () => {
    consume.mockRejectedValue(new Error('rate limiter unavailable'))

    const res = await GET(makeRequest('acme'))

    expect(res.status).toBe(200)
    expect(find).toHaveBeenCalled()
  })
})
