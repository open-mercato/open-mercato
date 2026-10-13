import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'
import { createFakeContainer } from './support/fakeContainer'

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => createFakeContainer({ em: { name: 'request-em' } }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScope(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import { GET, metadata } from '../api/get/companies/[id]/route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const COMPANY_ID = '44444444-4444-4444-8444-444444444444'
const XERO_ORG = 'a3b1c2d3-0000-4000-8000-000000000001'
const CONTACT_ID = 'c0000000-0000-4000-8000-000000000001'
const LINKED_AT = new Date('2026-10-13T09:30:00.000Z')

let company: { id: string; organizationId: string; tenantId: string } | null
let mapping: { externalId: string; lastSyncedAt: Date | null } | null

function request(): Request {
  return new Request(`http://localhost/api/sync_xero/companies/${COMPANY_ID}`)
}

async function badge(id: string = COMPANY_ID) {
  const response = await GET(request(), { params: Promise.resolve({ id }) })
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  company = { id: COMPANY_ID, organizationId: ORG_B, tenantId: TENANT_ID }
  mapping = { externalId: `${XERO_ORG}:${CONTACT_ID}`, lastSyncedAt: LINKED_AT }
  mockGetAuthFromRequest.mockReset().mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_A })
  mockResolveOrganizationScope.mockReset().mockResolvedValue({ selectedId: ORG_A, filterIds: [ORG_A, ORG_B], allowedIds: null, tenantId: TENANT_ID })
  mockFindOneWithDecryption.mockReset().mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === CustomerEntity) return company
    if (entity === SyncExternalIdMapping) return mapping
    throw new Error('[internal] unexpected lookup')
  })
})

describe('GET /api/sync_xero/companies/[id]', () => {
  it('requires customers.companies.view only, never integrations.view', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['customers.companies.view'] })
  })

  it('answers the Xero deep link and the link date of a mapped Company', async () => {
    await expect(badge()).resolves.toEqual({
      status: 200,
      body: { link: { externalUrl: `https://go.xero.com/Contacts/View/${CONTACT_ID}`, linkedSince: LINKED_AT.toISOString() } },
    })
  })

  it('reads the Company in the caller\'s organization scope and the mapping in the Company\'s own organization', async () => {
    await badge()

    const [companyCall, mappingCall] = mockFindOneWithDecryption.mock.calls
    expect(companyCall[1]).toBe(CustomerEntity)
    expect(companyCall[2]).toEqual({ id: COMPANY_ID, tenantId: TENANT_ID, kind: 'company', deletedAt: null, organizationId: { $in: [ORG_A, ORG_B] } })
    expect(mappingCall[1]).toBe(SyncExternalIdMapping)
    expect(mappingCall[2]).toEqual({
      integrationId: 'sync_xero',
      internalEntityType: 'customers.company',
      internalEntityId: COMPANY_ID,
      organizationId: ORG_B,
      tenantId: TENANT_ID,
      deletedAt: null,
    })
  })

  it('does not filter by organization for an unrestricted scope', async () => {
    mockResolveOrganizationScope.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID })
    await badge()
    expect(mockFindOneWithDecryption.mock.calls[0][2]).not.toHaveProperty('organizationId')
  })

  it('answers link null for a Company without a Xero mapping', async () => {
    mapping = null
    await expect(badge()).resolves.toEqual({ status: 200, body: { link: null } })
  })

  it('answers 404 for a Company outside the scope, exactly like a missing one, and for an empty scope', async () => {
    company = null
    await expect(badge()).resolves.toEqual({ status: 404, body: { error: 'The company was not found.', code: 'not_found' } })

    mockResolveOrganizationScope.mockResolvedValue({ selectedId: null, filterIds: [], allowedIds: null, tenantId: TENANT_ID })
    mockFindOneWithDecryption.mockClear()
    await expect(badge()).resolves.toMatchObject({ status: 404, body: { code: 'not_found' } })
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('answers 400 for an id that is not a UUID and 401 without a session', async () => {
    await expect(badge('not-a-uuid')).resolves.toMatchObject({ status: 400, body: { code: 'invalid_request' } })
    mockGetAuthFromRequest.mockResolvedValue(null)
    await expect(badge()).resolves.toMatchObject({ status: 401, body: { code: 'unauthorized' } })
  })

  it('answers 400 organization_scope_required for a session without a tenant, never 401', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: null, orgId: null })
    await expect(badge()).resolves.toMatchObject({ status: 400, body: { code: 'organization_scope_required' } })
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })
})
