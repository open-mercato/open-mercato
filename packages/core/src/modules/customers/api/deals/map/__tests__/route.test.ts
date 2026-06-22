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
// Raw-SQL seam used by buildDealListFilters' People/Companies association resolver
// (fetchDealIdsMatchingAssociations → em.getConnection().execute). Default: no association rows.
const executeMock = jest.fn()

const em = { fork: jest.fn(), getConnection: jest.fn(() => ({ execute: executeMock })) }

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

// Mock ONLY the token-search resolver in api/utils (preserving applyEntityIdRestriction etc.), so
// both the deal-field search (via buildDealListFilters) and the map route's company/person-name
// search can be driven deterministically without a real search index.
jest.mock('../../../utils', () => {
  const actual = jest.requireActual('../../../utils')
  return { ...actual, findMatchingEntityIdsBySearchTokensAcrossSources: jest.fn() }
})

import { GET } from '../route'
import { findMatchingEntityIdsBySearchTokensAcrossSources } from '../../../utils'
import {
  CustomerAddress,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
} from '../../../../data/entities'

const findMatchingMock = findMatchingEntityIdsBySearchTokensAcrossSources as jest.Mock

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
    findMatchingMock.mockResolvedValue(null)
    executeMock.mockResolvedValue([])
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

  it('serves the map under an "All organizations" scope where auth.orgId is empty (BUG-001 / #3481)', async () => {
    // Regression: the early guard previously hard-required `auth.orgId`, so the "All organizations"
    // header scope (no concrete org → empty auth.orgId) returned 401 and the map hung on an infinite
    // spinner, while the List/Kanban views aggregated fine. The route must instead fall through to the
    // resolved multi-org scope (resolveOrganizationScopeForRequest → filterIds) — the same contract the
    // deals List route relies on.
    getAuthMock.mockResolvedValueOnce({ sub: userId, tenantId, orgId: undefined })
    resolveScopeMock.mockResolvedValueOnce({ tenantId, filterIds: [scopedOrgId] })
    mockLinksAndAddresses()

    const response = await GET(new Request('http://localhost/api/customers/deals/map?pageSize=100'))

    expect(response.status).toBe(200)
    // Proves the request reached scope resolution + the query engine instead of bailing at the guard.
    expect(queryMock).toHaveBeenCalledWith(
      'customers:customer_deal',
      expect.objectContaining({ organizationId: scopedOrgId, organizationIds: [scopedOrgId] }),
    )
  })

  it('still returns 401 when neither auth.orgId nor the resolved scope yields any organization', async () => {
    // The fix relaxes the early guard, but the downstream empty-scope guard must keep failing closed:
    // no concrete org AND an empty resolved scope = no visibility = 401 (no data leak).
    getAuthMock.mockResolvedValueOnce({ sub: userId, tenantId, orgId: undefined })
    resolveScopeMock.mockResolvedValueOnce({ tenantId, filterIds: [] })

    const response = await GET(new Request('http://localhost/api/customers/deals/map'))

    expect(response.status).toBe(401)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('aggregates tenant-wide under unrestricted access where scope.filterIds is null (superadmin "All organizations", #3481)', async () => {
    // True superadmin / "all organizations" grant: resolveOrganizationScopeForRequest returns
    // filterIds: null (unrestricted). The map must aggregate across the whole tenant WITHOUT an
    // organizationId restriction — the same `organizationIds: null` contract the List route relies on —
    // rather than collapsing the null scope to an empty org list and 401'ing.
    getAuthMock.mockResolvedValueOnce({ sub: userId, tenantId, orgId: undefined, isSuperAdmin: true })
    resolveScopeMock.mockResolvedValueOnce({ tenantId, filterIds: null, allowedIds: null })
    mockLinksAndAddresses()

    const response = await GET(new Request('http://localhost/api/customers/deals/map?pageSize=100'))
    expect(response.status).toBe(200)

    // The deal query carries NO organizationId restriction (tenant-only) under unrestricted access.
    const dealQueryCall = queryMock.mock.calls.find((call) => call[0] === 'customers:customer_deal')
    expect(dealQueryCall?.[1]?.tenantId).toBe(tenantId)
    expect(dealQueryCall?.[1]?.organizationIds).toBeUndefined()
    expect(dealQueryCall?.[1]?.organizationId).toBeUndefined()
    // `organization_id` MUST be projected so the query engine decrypts each row's encrypted `title`
    // with the row's own org — without it, titles return as ciphertext under the unrestricted scope
    // (no single fallback org to decrypt with). Regression guard for the #3481 decryption fix.
    expect(dealQueryCall?.[1]?.fields).toContain('organization_id')

    // Both address fetches are tenant-scoped with NO organizationId $in clause, and the decryption
    // fallback carries no concrete org (per-row decryption resolves each row's own organization).
    const lightAddressCall = findWithDecryptionMock.mock.calls.find(
      (call) => call[1] === CustomerAddress && call[3]?.fields,
    )
    expect(lightAddressCall?.[2]).toEqual({
      latitude: { $ne: null },
      longitude: { $ne: null },
      tenantId,
    })
    expect(lightAddressCall?.[2]?.organizationId).toBeUndefined()
    expect(lightAddressCall?.[4]).toEqual({ tenantId })

    // The page-bounded heavy address fetch must also omit the org $in clause under unrestricted access.
    const heavyAddressCall = findWithDecryptionMock.mock.calls.find(
      (call) => call[1] === CustomerAddress && !call[3]?.fields && call[2]?.entity,
    )
    expect(heavyAddressCall?.[2]?.organizationId).toBeUndefined()
  })

  it('queries every organization in a multi-org scope and passes orgFilterIds[0] as the decryption fallback', async () => {
    // "All organizations" scope: the resolved scope carries more than one org. This asserts the
    // ROUTE's multi-org contract — deal + address fetches span the whole org set (`$in`) and the
    // decryption fallback scope is orgFilterIds[0]. The route relies on `findWithDecryption`
    // decrypting each row with the row's OWN org (fallback only when a row lacks scope columns);
    // that per-row property is proven separately in
    // `packages/shared/src/lib/encryption/__tests__/subscriber.test.ts` (findWithDecryption is mocked
    // here, so this suite cannot — and does not claim to — exercise real decryption).
    const secondOrgId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    resolveScopeMock.mockResolvedValueOnce({ tenantId, filterIds: [scopedOrgId, secondOrgId] })
    mockLinksAndAddresses()

    const response = await GET(new Request('http://localhost/api/customers/deals/map?pageSize=100'))
    expect(response.status).toBe(200)

    // The deal page query targets the first org but carries the full org set for query-engine scoping.
    expect(queryMock).toHaveBeenCalledWith(
      'customers:customer_deal',
      expect.objectContaining({
        organizationId: scopedOrgId,
        organizationIds: [scopedOrgId, secondOrgId],
      }),
    )

    // Both the light (id-only) and heavy (decrypted) address fetches filter across BOTH orgs ($in),
    // and pass orgFilterIds[0] as the decryption fallback scope.
    const lightAddressCall = findWithDecryptionMock.mock.calls.find(
      (call) => call[1] === CustomerAddress && call[3]?.fields,
    )
    expect(lightAddressCall?.[2]).toEqual({
      latitude: { $ne: null },
      longitude: { $ne: null },
      tenantId,
      organizationId: { $in: [scopedOrgId, secondOrgId] },
    })
    expect(lightAddressCall?.[4]).toEqual({ tenantId, organizationId: scopedOrgId })

    const heavyAddressCall = findWithDecryptionMock.mock.calls.find(
      (call) => call[1] === CustomerAddress && !call[3]?.fields,
    )
    expect(heavyAddressCall?.[2]).toEqual(
      expect.objectContaining({ organizationId: { $in: [scopedOrgId, secondOrgId] } }),
    )
    expect(heavyAddressCall?.[4]).toEqual({ tenantId, organizationId: scopedOrgId })

    // The route projects the resolved location (as returned by findWithDecryption) into the response.
    const body = await response.json()
    const located = body.items.find((item: { id: string }) => item.id === locatedDealId)
    expect(located?.location?.city).toBe('Warszawa')
  })

  it('surfaces a located deal whose linked company/person NAME matches the search, even when no deal field matches', async () => {
    mockLinksAndAddresses()
    // Deal-field token search (entityType customers:customer_deal, via buildDealListFilters) finds
    // nothing; the company/person ENTITY name search (entityType customers:customer_entity, the map
    // card headline) matches the located company. The map must still return its located deal.
    findMatchingMock.mockImplementation(async ({ sources }: { sources?: Array<{ entityType?: unknown }> }) => {
      const entityType = String(sources?.[0]?.entityType ?? '')
      if (entityType === 'customers:customer_entity') return [companyEntityId]
      return []
    })

    const response = await GET(new Request('http://localhost/api/customers/deals/map?search=Volt'))
    expect(response.status).toBe(200)

    // The deal query is restricted to the name-matched located deal — not collapsed to the
    // deal-field "no match" sentinel.
    const dealQueryCall = queryMock.mock.calls.find((call) => call[0] === 'customers:customer_deal')
    expect(dealQueryCall?.[1]?.filters?.id).toEqual({ $in: [locatedDealId] })

    const body = await response.json()
    const located = body.items.find((item: { id: string }) => item.id === locatedDealId)
    expect(located).toBeTruthy()
    expect(located?.companies).toEqual([{ id: companyEntityId, label: 'Volt Energia SA' }])
  })

  it('does not let a company/person-name search bypass a co-active Companies filter', async () => {
    mockLinksAndAddresses()
    // The Companies filter resolves (via the association SQL) to a deal that is NOT the located,
    // name-matched deal — i.e. the filtered company has no link to the searched company's deal.
    const acmeDealId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    executeMock.mockResolvedValue([{ id: acmeDealId }])
    // The company/person-NAME search matches the located company (whose located deal is locatedDealId).
    findMatchingMock.mockImplementation(async ({ sources }: { sources?: Array<{ entityType?: unknown }> }) => {
      const entityType = String(sources?.[0]?.entityType ?? '')
      if (entityType === 'customers:customer_entity') return [companyEntityId]
      return []
    })

    const companyFilterId = '12121212-1212-4121-8121-121212121212'
    const response = await GET(
      new Request(`http://localhost/api/customers/deals/map?companyId=${companyFilterId}&search=Copperleaf`),
    )
    expect(response.status).toBe(200)

    // The name-matched located deal is NOT linked to the filtered company, so it must be excluded —
    // the union must NOT smuggle it past the active Companies filter (regression for the over-broad
    // search-by-name finding).
    const dealQueryCall = queryMock.mock.calls.find((call) => call[0] === 'customers:customer_deal')
    expect((dealQueryCall?.[1]?.filters?.id?.$in ?? []) as string[]).not.toContain(locatedDealId)
  })

  it('does not run the company/person-name search when there is no search term', async () => {
    mockLinksAndAddresses()
    await GET(new Request('http://localhost/api/customers/deals/map?status=open'))
    expect(findMatchingMock).not.toHaveBeenCalled()
  })
})
