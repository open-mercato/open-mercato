/** @jest-environment node */

// Regression coverage for issue #5504: the company detail route must not form an
// existence oracle. The API dispatcher already enforces `requireFeatures`
// (a uniform 403) before the handler runs, so the reachable caller here is a
// GRANTED one. For that caller, a record that exists in an organization outside
// their scope must return the SAME response as a non-existent id — otherwise
// 403-when-present / 404-when-absent leaks existence. The route now collapses
// the post-load organization-scope denial into its not-found response, so both
// are a uniform 404. Before the fix the foreign-org record returned 403.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockResolveCustomerInteractionFeatureFlags = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockIsOrganizationReadAccessAllowed = jest.fn()

const mockEm = {
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'queryEngine') return { query: jest.fn(async () => ({ items: [] })) }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScopeForRequest(args)),
}))

// The route rejects out-of-scope reads through the shared
// denyCustomerDetailReadAsNotFound helper, which consults this guard. Control
// the guard so the "record exists in a foreign org" branch is exercised.
jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeGuard', () => ({
  isOrganizationReadAccessAllowed: jest.fn((...args: unknown[]) => mockIsOrganizationReadAccessAllowed(...args)),
}))

jest.mock('../../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn((...args: unknown[]) => mockResolveCustomerInteractionFeatureFlags(...args)),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('../../../../lib/customFieldRouting', () => ({
  resolveCompanyCustomFieldRouting: jest.fn(async () => new Map()),
  mergeCompanyCustomFieldValues: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('../../../../lib/interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async () => []),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_entity: 'customer_entity',
      customer_company_profile: 'customer_company_profile',
    },
  },
}), { virtual: true })

const EXISTING_FOREIGN_ID = '2408107d-0000-4000-8000-0000000000bb'
const NON_EXISTENT_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'

function buildForeignCompany(id: string) {
  const createdAt = new Date('2026-04-10T08:00:00.000Z')
  return {
    id,
    kind: 'company',
    deletedAt: null,
    tenantId: 'tenant-1',
    organizationId: 'org-foreign',
    companyProfile: null,
    displayName: 'Acme Corp',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
    temperature: null,
    renewalQuarter: null,
    createdAt,
    updatedAt: createdAt,
  }
}

async function callDetail(id: string) {
  const { GET } = await import('../route')
  const response = await GET(
    new Request(`http://localhost/api/customers/companies/${id}`),
    { params: { id } },
  )
  const body = await response.json()
  return { status: response.status, body }
}

describe('GET /api/customers/companies/[id] — no existence oracle (issue #5504)', () => {
  beforeEach(() => {
    jest.resetModules()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockResolveCustomerInteractionFeatureFlags.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockFindWithDecryption.mockReset()
    mockIsOrganizationReadAccessAllowed.mockReset()
    mockEm.findOne.mockReset()
    mockEm.find.mockReset()
    mockEm.count.mockReset()
    mockEm.count.mockResolvedValue(0)
    mockEm.find.mockResolvedValue([])
    mockFindWithDecryption.mockResolvedValue([])
    mockContainer.resolve.mockClear()

    // A granted, authenticated user in tenant-1 / org-1 (the dispatcher already
    // let them through) probing records that live in a different organization.
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', isApiKey: false })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ filterIds: ['org-1'], selectedId: 'org-1', tenantId: 'tenant-1' })
    mockResolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    // The resolved record's organization is outside the caller's scope.
    mockIsOrganizationReadAccessAllowed.mockReturnValue(false)
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) =>
      where?.id === EXISTING_FOREIGN_ID ? buildForeignCompany(EXISTING_FOREIGN_ID) : null,
    )
  })

  it('returns an identical 404 for an existing foreign-org record and a non-existent id', async () => {
    const existing = await callDetail(EXISTING_FOREIGN_ID)
    const missing = await callDetail(NON_EXISTENT_ID)

    // Before the fix the existing foreign-org record returned 403 while the
    // missing id returned 404 — the oracle the issue reports.
    expect(existing.status).toBe(404)
    expect(missing.status).toBe(404)
    // The oracle is closed only if the two responses are indistinguishable.
    expect(missing.status).toBe(existing.status)
    expect(missing.body).toEqual(existing.body)
    expect(existing.body).toEqual({ error: 'Company not found' })
  })
})
