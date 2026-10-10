/** @jest-environment node */

// Coverage the merged parity spec assigns to this PR (§ "PR 2 — API"). The sibling suite at
// `api/deals/[id]/__tests__/route.existenceOracle.test.ts` covers the deal DETAIL route, not
// this one, so none of the four cases below were reachable before.
//
// The third case is the load-bearing one: this handler gained a SECOND scoped data-access
// path in this PR — the batched `CustomerPersonProfile` read — so the #5504 guarantee (a
// cross-organization read is denied as not-found, never 403, so the response cannot reveal
// that the deal exists) needs re-proving here rather than inherited.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockIsOrganizationReadAccessAllowed = jest.fn()

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  fork: jest.fn(),
}
mockEm.fork.mockReturnValue(mockEm)

const mockContainer = {
  resolve: jest.fn((token: string) => (token === 'em' ? mockEm : null)),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) =>
    mockResolveOrganizationScopeForRequest(args),
  ),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeGuard', () => ({
  isOrganizationReadAccessAllowed: jest.fn((...args: unknown[]) =>
    mockIsOrganizationReadAccessAllowed(...args),
  ),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

// Imported fresh inside `beforeEach`, after `jest.resetModules()`, so these are the SAME class
// objects the route under test resolves. A top-level import would be a different instance and
// every `entity === ...` check below would silently never match.
type Entities = typeof import('../../../../../data/entities')
let entities: Entities

const DEAL_ID = '2408107d-0000-4000-8000-00000000d0a1'
const FOREIGN_DEAL_ID = '2408107d-0000-4000-8000-0000000000cc'
const NON_EXISTENT_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const ADA = '2408107d-0000-4000-8000-00000000a001'
const BOB = '2408107d-0000-4000-8000-00000000a002'

const LINKED_AT = new Date('2026-04-10T08:00:00.000Z')

function buildDeal(id: string, organizationId: string) {
  return {
    id,
    organizationId,
    tenantId: 'tenant-1',
    title: 'Expansion renewal',
    deletedAt: null,
    createdAt: LINKED_AT,
    updatedAt: LINKED_AT,
  }
}

function buildPerson(id: string, displayName: string, email: string) {
  return {
    id,
    displayName,
    primaryEmail: email,
    primaryPhone: null,
    status: 'active',
    lifecycleStage: 'customer',
    createdAt: LINKED_AT,
    organizationId: 'org-1',
    temperature: 'warm',
    source: 'Referral',
  }
}

function buildLink(person: ReturnType<typeof buildPerson>, isPrimary = false) {
  return { id: `link-${person.id}`, person, isPrimary, createdAt: LINKED_AT }
}

async function callPeople(id: string, query = '') {
  const { GET } = await import('../route')
  const response = await GET(
    new Request(`http://localhost/api/customers/deals/${id}/people${query}`),
    { params: { id } },
  )
  return { status: response.status, body: await response.json() }
}

describe('GET /api/customers/deals/[id]/people', () => {
  beforeEach(async () => {
    jest.resetModules()
    entities = await import('../../../../../data/entities')
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockFindWithDecryption.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockIsOrganizationReadAccessAllowed.mockReset()
    mockEm.find.mockReset()
    mockEm.findOne.mockReset()
    mockContainer.resolve.mockClear()

    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      email: 'viewer@example.com',
      isApiKey: false,
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      filterIds: ['org-1'],
      selectedId: 'org-1',
      tenantId: 'tenant-1',
    })
    mockIsOrganizationReadAccessAllowed.mockReturnValue(true)
    mockFindOneWithDecryption.mockImplementation(
      async (_em: unknown, _entity: unknown, where: Record<string, unknown>) =>
        where?.id === DEAL_ID ? buildDeal(DEAL_ID, 'org-1') : null,
    )
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === entities.CustomerDealPersonLink) {
        return [
          buildLink(buildPerson(ADA, 'Ada Lovelace', 'ada@example.com'), true),
          buildLink(buildPerson(BOB, 'Grace Hopper', 'grace@example.com')),
        ]
      }
      if (entity === entities.CustomerPersonProfile) {
        return [
          { entity: { id: ADA }, jobTitle: 'VP Partnerships', department: 'Partnerships' },
        ]
      }
      return []
    })
  })

  it('returns the widened payload alongside every pre-existing key', async () => {
    const { status, body } = await callPeople(DEAL_ID)

    expect(status).toBe(200)
    expect(body).toMatchObject({ total: 2, page: 1, pageSize: 20, totalPages: 1 })

    const ada = body.items.find((item: { id: string }) => item.id === ADA)
    // The six keys `DealLinkedEntitiesTab` and any third-party consumer already read.
    expect(ada).toMatchObject({
      id: ADA,
      label: 'Ada Lovelace',
      subtitle: 'ada@example.com',
      kind: 'person',
      linkedAt: LINKED_AT.toISOString(),
      isPrimary: true,
    })
    // The eleven added alongside them, including the two that come from the profile read.
    expect(ada).toMatchObject({
      displayName: 'Ada Lovelace',
      primaryEmail: 'ada@example.com',
      primaryPhone: null,
      status: 'active',
      lifecycleStage: 'customer',
      jobTitle: 'VP Partnerships',
      department: 'Partnerships',
      createdAt: LINKED_AT.toISOString(),
      organizationId: 'org-1',
      temperature: 'warm',
      source: 'Referral',
    })
    // A person with no profile row still yields the keys, as null rather than absent.
    const bob = body.items.find((item: { id: string }) => item.id === BOB)
    expect(bob).toMatchObject({ jobTitle: null, department: null })
  })

  it('resolves profile fields in one batched query rather than one per row', async () => {
    await callPeople(DEAL_ID)

    const profileCalls = mockFindWithDecryption.mock.calls.filter(
      (call) => call[1] === entities.CustomerPersonProfile,
    )
    expect(profileCalls).toHaveLength(1)
    // Keyed by every linked person at once, and scoped to the deal's own tenant/org.
    expect(profileCalls[0][2]).toEqual({
      entity: { $in: [ADA, BOB] },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('denies a cross-organization read as not-found, identically to a missing deal (#5504)', async () => {
    mockFindOneWithDecryption.mockImplementation(
      async (_em: unknown, _entity: unknown, where: Record<string, unknown>) =>
        where?.id === FOREIGN_DEAL_ID ? buildDeal(FOREIGN_DEAL_ID, 'org-foreign') : null,
    )
    mockIsOrganizationReadAccessAllowed.mockReturnValue(false)

    const foreign = await callPeople(FOREIGN_DEAL_ID)
    const missing = await callPeople(NON_EXISTENT_ID)

    expect(foreign.status).toBe(404)
    expect(foreign.status).toBe(missing.status)
    expect(foreign.body).toEqual(missing.body)
    expect(foreign.body).toEqual({ error: 'Deal not found' })
    // The denial must happen before any link or profile row is read, so timing and error
    // shape stay indistinguishable from the deal simply not existing.
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('matches search against an added field, not just the pre-existing ones', async () => {
    // `jobTitle` arrives only through the profile read this PR introduced, so a hit on it
    // proves the widened fields feed the filter rather than merely riding in the response.
    const { body } = await callPeople(DEAL_ID, '?search=partnerships')

    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: ADA, jobTitle: 'VP Partnerships' })
    expect(body.total).toBe(1)
  })
})
