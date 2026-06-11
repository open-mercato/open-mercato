/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
// Distinct from auth.orgId so assertions prove the route honors the RESOLVED scope, not the
// auth.orgId fallback (regression guard for the previously-vacuous scope assertion).
const scopedOrgId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const userId = '33333333-3333-4333-8333-333333333333'
const pipelineId = '44444444-4444-4444-8444-444444444444'
const stageId = '99999999-9999-4999-8999-999999999999'
const ownerUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const locatedDealId = '55555555-5555-4555-8555-555555555555'
const companyEntityId = '77777777-7777-4777-8777-777777777777'
const personEntityId = '88888888-8888-4888-8888-888888888888'
const companyAddressId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const personAddressId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const getAuthMock = jest.fn()
const queryMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const resolveScopeMock = jest.fn()

const em = { fork: jest.fn() }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'queryEngine') return { query: queryMock }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveScopeMock(...args),
}))

import { GET } from '../route'
import {
  CustomerAddress,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
} from '../../../../data/entities'

function mockLinksAndAddresses() {
  findWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === CustomerAddress) {
      return [
        {
          id: companyAddressId,
          entity: { id: companyEntityId },
          isPrimary: true,
          latitude: 52.19,
          longitude: 21.0,
          city: 'Warszawa',
          region: 'Mazowieckie',
          country: 'PL',
          createdAt: new Date('2026-01-03T00:00:00Z'),
        },
        {
          id: personAddressId,
          entity: { id: personEntityId },
          isPrimary: true,
          latitude: 50.0625,
          longitude: 19.9375,
          city: 'Kraków',
          region: 'Małopolskie',
          country: 'PL',
          createdAt: new Date('2026-01-04T00:00:00Z'),
        },
      ]
    }
    if (entity === CustomerDealCompanyLink) {
      return [
        {
          deal: { id: locatedDealId },
          company: { id: companyEntityId, displayName: 'Volt Energia SA' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]
    }
    if (entity === CustomerDealPersonLink) {
      return [
        {
          deal: { id: locatedDealId },
          person: { id: personEntityId, displayName: 'Anna Nowak' },
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
      ]
    }
    return []
  })
}

describe('customers deals map route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    resolveScopeMock.mockResolvedValue({ tenantId, filterIds: [scopedOrgId] })
    queryMock.mockResolvedValue({
      items: [
        {
          id: locatedDealId,
          title: 'Volt rollout',
          status: 'open',
          pipeline_id: pipelineId,
          pipeline_stage_id: stageId,
          pipeline_stage: 'Contract',
          value_amount: '540000.00',
          value_currency: 'PLN',
          probability: 85,
          expected_close_at: '2026-05-12',
          owner_user_id: ownerUserId,
          updated_at: '2026-06-01T10:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    })
    findWithDecryptionMock.mockResolvedValue([])
  })

  it('returns camelCase located deals with a company-sourced location resolved from decrypted addresses', async () => {
    mockLinksAndAddresses()

    const response = await GET(new Request('http://localhost/api/customers/deals/map?status=open'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(100)
    expect(body.totalPages).toBe(1)

    const located = body.items.find((item: { id: string }) => item.id === locatedDealId)
    expect(located).toEqual({
      id: locatedDealId,
      title: 'Volt rollout',
      status: 'open',
      pipelineId,
      pipelineStageId: stageId,
      pipelineStage: 'Contract',
      valueAmount: 540000,
      valueCurrency: 'PLN',
      probability: 85,
      expectedCloseAt: '2026-05-12',
      ownerUserId,
      updatedAt: '2026-06-01T10:00:00.000Z',
      companies: [{ id: companyEntityId, label: 'Volt Energia SA' }],
      people: [{ id: personEntityId, label: 'Anna Nowak' }],
      location: {
        latitude: 52.19,
        longitude: 21,
        city: 'Warszawa',
        region: 'Mazowieckie',
        country: 'PL',
        source: 'company',
        entityId: companyEntityId,
        addressId: companyAddressId,
      },
    })
  })

  it('restricts the deal query to deals that have a coordinate-bearing address', async () => {
    mockLinksAndAddresses()

    const response = await GET(new Request('http://localhost/api/customers/deals/map'))

    expect(response.status).toBe(200)
    const [, options] = queryMock.mock.calls[0] as [string, { filters: Record<string, unknown> }]
    expect(options.filters.id).toEqual({ $in: [locatedDealId] })
  })

  it('returns an empty page (without querying deals) when no coordinate-bearing addresses exist', async () => {
    // Default mock returns [] for every entity, including CustomerAddress → no located entities.
    const response = await GET(new Request('http://localhost/api/customers/deals/map'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('honors the resolved organization scope rather than the auth.orgId fallback', async () => {
    mockLinksAndAddresses()

    const response = await GET(
      new Request('http://localhost/api/customers/deals/map?status=open&sortField=value&sortDir=desc'),
    )

    expect(response.status).toBe(200)
    expect(resolveScopeMock).toHaveBeenCalledWith(
      expect.objectContaining({ container, auth: expect.objectContaining({ tenantId }) }),
    )
    expect(queryMock).toHaveBeenCalledWith(
      'customers:customer_deal',
      expect.objectContaining({
        tenantId,
        organizationId: scopedOrgId,
        organizationIds: [scopedOrgId],
        filters: expect.objectContaining({ status: { $eq: 'open' } }),
        // Stable id tiebreaker is appended after the requested sort column.
        sort: [
          { field: 'value_amount', dir: 'desc' },
          { field: 'id', dir: 'asc' },
        ],
        page: { page: 1, pageSize: 100 },
      }),
    )

    // Stage 1 — LIGHT, id-only queries (no decryption) resolve the located-deal universe.
    const lightAddressCall = findWithDecryptionMock.mock.calls.find(
      (call) => call[1] === CustomerAddress && call[3]?.fields,
    )
    expect(lightAddressCall?.[2]).toEqual({
      latitude: { $ne: null },
      longitude: { $ne: null },
      tenantId,
      organizationId: { $in: [scopedOrgId] },
    })
    expect(lightAddressCall?.[3]).toEqual({ fields: ['entity'] })
    expect(lightAddressCall?.[4]).toEqual({ tenantId, organizationId: scopedOrgId })

    const lightCompanyCall = findWithDecryptionMock.mock.calls.find(
      (call) => call[1] === CustomerDealCompanyLink && call[3]?.fields,
    )
    expect(lightCompanyCall?.[2]).toEqual({ company: { $in: [companyEntityId, personEntityId] } })
    expect(lightCompanyCall?.[3]).toEqual({ fields: ['deal'] })

    // Stage 2 — HEAVY, page-bounded fetch: decrypted/populated links + addresses for THIS page only.
    const heavyCompanyCall = findWithDecryptionMock.mock.calls.find(
      (call) => call[1] === CustomerDealCompanyLink && call[3]?.populate,
    )
    expect(heavyCompanyCall?.[2]).toEqual({ deal: { $in: [locatedDealId] } })
    expect(heavyCompanyCall?.[3]).toEqual({ populate: ['company'] })
    expect(heavyCompanyCall?.[4]).toEqual({ tenantId, organizationId: scopedOrgId })

    const heavyAddressCall = findWithDecryptionMock.mock.calls.find(
      (call) => call[1] === CustomerAddress && !call[3]?.fields,
    )
    expect(heavyAddressCall?.[2]).toEqual({
      entity: { $in: [companyEntityId, personEntityId] },
      latitude: { $ne: null },
      longitude: { $ne: null },
      tenantId,
      organizationId: { $in: [scopedOrgId] },
    })
    expect(heavyAddressCall?.[4]).toEqual({ tenantId, organizationId: scopedOrgId })
  })

  it('defaults the sort to id when no sortField is supplied', async () => {
    mockLinksAndAddresses()

    await GET(new Request('http://localhost/api/customers/deals/map'))

    expect(queryMock).toHaveBeenCalledWith(
      'customers:customer_deal',
      expect.objectContaining({ sort: [{ field: 'id', dir: 'asc' }] }),
    )
  })

  it('preserves every value of repeated multi-select filter params', async () => {
    mockLinksAndAddresses()

    const response = await GET(
      new Request(
        `http://localhost/api/customers/deals/map?status=open&status=win&ownerUserId=${ownerUserId}&ownerUserId=${userId}`,
      ),
    )

    expect(response.status).toBe(200)
    expect(queryMock).toHaveBeenCalledWith(
      'customers:customer_deal',
      expect.objectContaining({
        filters: expect.objectContaining({
          status: { $in: ['open', 'win'] },
          owner_user_id: { $in: [ownerUserId, userId] },
        }),
      }),
    )
  })

  it('treats a comma-separated multi-select filter param the same as repeated params', async () => {
    mockLinksAndAddresses()

    const response = await GET(
      new Request('http://localhost/api/customers/deals/map?status=open,win'),
    )

    expect(response.status).toBe(200)
    expect(queryMock).toHaveBeenCalledWith(
      'customers:customer_deal',
      expect.objectContaining({
        filters: expect.objectContaining({ status: { $in: ['open', 'win'] } }),
      }),
    )
  })

  it('rejects pageSize above 100 with 400', async () => {
    const response = await GET(new Request('http://localhost/api/customers/deals/map?pageSize=101'))

    expect(response.status).toBe(400)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('rejects unknown sortField values with 400', async () => {
    const response = await GET(new Request('http://localhost/api/customers/deals/map?sortField=bogus'))

    expect(response.status).toBe(400)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the request is unauthenticated', async () => {
    getAuthMock.mockResolvedValueOnce(null)

    const response = await GET(new Request('http://localhost/api/customers/deals/map'))

    expect(response.status).toBe(401)
    expect(queryMock).not.toHaveBeenCalled()
  })
})
