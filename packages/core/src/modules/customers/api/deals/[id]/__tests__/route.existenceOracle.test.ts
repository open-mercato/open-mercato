/** @jest-environment node */

// Regression coverage for issue #5504 (deals kept consistent with people/
// companies): a granted caller whose scope excludes a deal's organization must
// receive the SAME response as for a non-existent id. The route collapses the
// post-load organization-scope denial into its not-found response, so both are a
// uniform 404. Before the change the foreign-org deal returned 403.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockLoadCustomFieldValues = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockDecryptEntitiesWithFallbackScope = jest.fn()
const mockIsOrganizationReadAccessAllowed = jest.fn()

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
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
// denyCustomerDetailReadAsNotFound helper, which consults this guard.
jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeGuard', () => ({
  isOrganizationReadAccessAllowed: jest.fn((...args: unknown[]) => mockIsOrganizationReadAccessAllowed(...args)),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn((args: unknown) => mockLoadCustomFieldValues(args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({
  decryptEntitiesWithFallbackScope: jest.fn((...args: unknown[]) => mockDecryptEntitiesWithFallbackScope(...args)),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_deal: 'customer_deal',
    },
  },
}), { virtual: true })

const EXISTING_FOREIGN_ID = '2408107d-0000-4000-8000-0000000000cc'
const NON_EXISTENT_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'

function buildForeignDeal(id: string) {
  const createdAt = new Date('2026-04-10T08:00:00.000Z')
  return {
    id,
    organizationId: 'org-foreign',
    tenantId: 'tenant-1',
    title: 'Expansion renewal',
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
  }
}

async function callDetail(id: string) {
  const { GET } = await import('../route')
  const response = await GET(
    new Request(`http://localhost/api/customers/deals/${id}`),
    { params: { id } },
  )
  const body = await response.json()
  return { status: response.status, body }
}

describe('GET /api/customers/deals/[id] — no existence oracle (issue #5504)', () => {
  beforeEach(() => {
    jest.resetModules()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockLoadCustomFieldValues.mockReset()
    mockFindWithDecryption.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockDecryptEntitiesWithFallbackScope.mockReset()
    mockIsOrganizationReadAccessAllowed.mockReset()
    mockEm.find.mockReset()
    mockEm.findOne.mockReset()
    mockContainer.resolve.mockClear()

    // A granted, authenticated user in tenant-1 / org-1 (the dispatcher already
    // let them through) probing deals that live in a different organization.
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', email: 'viewer@example.com', isApiKey: false })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ filterIds: ['org-1'], selectedId: 'org-1', tenantId: 'tenant-1' })
    mockLoadCustomFieldValues.mockResolvedValue({})
    mockFindWithDecryption.mockResolvedValue([])
    mockDecryptEntitiesWithFallbackScope.mockResolvedValue(undefined)
    // The resolved deal's organization is outside the caller's scope.
    mockIsOrganizationReadAccessAllowed.mockReturnValue(false)
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) =>
      where?.id === EXISTING_FOREIGN_ID ? buildForeignDeal(EXISTING_FOREIGN_ID) : null,
    )
  })

  it('returns an identical 404 for an existing foreign-org deal and a non-existent id', async () => {
    const existing = await callDetail(EXISTING_FOREIGN_ID)
    const missing = await callDetail(NON_EXISTENT_ID)

    expect(existing.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(missing.status).toBe(existing.status)
    expect(missing.body).toEqual(existing.body)
    expect(existing.body).toEqual({ error: 'Deal not found' })
  })
})
