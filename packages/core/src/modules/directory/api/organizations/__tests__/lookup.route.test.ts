/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '33333333-3333-4333-8333-333333333333'
const organizationId = '22222222-2222-4222-8222-222222222222'

const findOne = jest.fn()
const resolveByHostname = jest.fn()

let domainMappingServiceRegistered = true

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return { findOne }
    if (name === 'domainMappingService') {
      if (!domainMappingServiceRegistered) throw new Error('Could not resolve domainMappingService')
      return { resolveByHostname }
    }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

const consume = jest.fn(async () => ({ allowed: true, msBeforeNext: 0, remainingPoints: 19 }))
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
  return { id: organizationId, name: 'Acme', slug: 'acme' }
}

describe('GET /api/directory/organizations/lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    domainMappingServiceRegistered = true
    rateLimiterService = { trustProxyDepth: 1, consume }
    consume.mockResolvedValue({ allowed: true, msBeforeNext: 0, remainingPoints: 19 })
    findOne.mockResolvedValue(makeOrganization())
    resolveByHostname.mockResolvedValue(null)
  })

  it('scopes the lookup to the tenant implied by an active custom-domain host', async () => {
    resolveByHostname.mockResolvedValue({ tenantId, status: 'active' })

    const res = await GET(makeRequest('acme', { host: 'shop.acme.com' }))

    expect(res.status).toBe(200)
    expect(resolveByHostname).toHaveBeenCalledWith('shop.acme.com')
    const [, filter] = findOne.mock.calls[0]
    expect(filter).toMatchObject({ slug: 'acme', deletedAt: null, tenant: tenantId })
  })

  it('does not leak another tenant org when the custom-domain host owns no such slug', async () => {
    resolveByHostname.mockResolvedValue({ tenantId, status: 'active' })
    findOne.mockResolvedValue(null)

    const res = await GET(makeRequest('competitor', { host: 'shop.acme.com' }))

    expect(res.status).toBe(404)
    const [, filter] = findOne.mock.calls[0]
    expect(filter).toMatchObject({ tenant: tenantId })
  })

  it('resolves globally but deterministically on the platform domain', async () => {
    resolveByHostname.mockResolvedValue(null)

    const res = await GET(makeRequest('acme', { host: 'app.openmercato.com' }))

    expect(res.status).toBe(200)
    const [, filter, options] = findOne.mock.calls[0]
    expect(filter).not.toHaveProperty('tenant')
    expect(options).toEqual({ orderBy: { createdAt: 'ASC' } })
  })

  it('ignores an inactive domain mapping and keeps the global resolution', async () => {
    resolveByHostname.mockResolvedValue({ tenantId: otherTenantId, status: 'pending' })

    const res = await GET(makeRequest('acme', { host: 'pending.acme.com' }))

    expect(res.status).toBe(200)
    const [, filter] = findOne.mock.calls[0]
    expect(filter).not.toHaveProperty('tenant')
  })

  it('degrades to the global resolution when the domain-mapping peer is absent', async () => {
    domainMappingServiceRegistered = false

    const res = await GET(makeRequest('acme', { host: 'shop.acme.com' }))

    expect(res.status).toBe(200)
    const [, filter] = findOne.mock.calls[0]
    expect(filter).not.toHaveProperty('tenant')
  })

  it('rate limits slug enumeration per IP before hitting the database', async () => {
    consume.mockResolvedValue({ allowed: false, msBeforeNext: 30_000, remainingPoints: 0 })

    const res = await GET(makeRequest('acme'))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(findOne).not.toHaveBeenCalled()
  })

  it('rejects an empty slug', async () => {
    const res = await GET(makeRequest(''))

    expect(res.status).toBe(400)
    expect(findOne).not.toHaveBeenCalled()
  })
})
