const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const MAPPING_A = '33333333-3333-4333-8333-333333333333'
const MAPPING_B = '44444444-4444-4444-8444-444444444444'

let authValue: Record<string, unknown> | null = null
let domainService: unknown = null

const findByOrganization = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'domainMappingService' && domainService) return domainService
    throw new Error(`[internal] ${name} is not registered`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => null),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import { GET, metadata, openApi } from '../route'

const request = () => new Request('http://localhost/api/ecommerce/domain-mappings')

describe('GET /api/ecommerce/domain-mappings', () => {
  beforeEach(() => {
    authValue = { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID }
    domainService = { findByOrganization }
    findByOrganization.mockReset().mockResolvedValue([
      {
        id: MAPPING_B,
        hostname: 'shop.example.com',
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        status: 'active',
        lastDnsCheckAt: new Date('2026-10-04T08:00:00.000Z'),
        dnsFailureReason: null,
        tlsFailureReason: null,
      },
      {
        id: MAPPING_A,
        hostname: 'asia.example.com',
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        status: 'tls_failed',
        lastDnsCheckAt: null,
        dnsFailureReason: null,
        tlsFailureReason: 'Certificate request rejected',
      },
      {
        id: 'foreign',
        hostname: 'foreign.example.com',
        organizationId: 'other-org',
        tenantId: TENANT_ID,
        status: 'active',
      },
    ])
  })

  it('is gated by ecommerce.stores.view and documents the response', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['ecommerce.stores.view'] })
    expect(openApi.methods.GET?.responses?.[0]?.status).toBe(200)
  })

  it('lists the organization mappings with status, last DNS check and TLS failure reason, sorted by hostname', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(findByOrganization).toHaveBeenCalledWith(ORG_ID, { tenantId: TENANT_ID })
    expect(await response.json()).toEqual({
      total: 2,
      items: [
        {
          id: MAPPING_A,
          hostname: 'asia.example.com',
          status: 'tls_failed',
          lastDnsCheckAt: null,
          dnsFailureReason: null,
          tlsFailureReason: 'Certificate request rejected',
        },
        {
          id: MAPPING_B,
          hostname: 'shop.example.com',
          status: 'active',
          lastDnsCheckAt: '2026-10-04T08:00:00.000Z',
          dnsFailureReason: null,
          tlsFailureReason: null,
        },
      ],
    })
  })

  it('rejects an unauthenticated request with a translated message', async () => {
    authValue = null
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Sign in to continue.' })
  })

  it('answers 503 with a translated message when the domain mapping service is not registered', async () => {
    domainService = null
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Domains are unavailable right now. Try again later.' })
  })

  it('answers 500 with a translated message when the lookup fails', async () => {
    findByOrganization.mockRejectedValueOnce(new Error('[internal] database unavailable'))
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Something went wrong. Try again.' })
  })
})
