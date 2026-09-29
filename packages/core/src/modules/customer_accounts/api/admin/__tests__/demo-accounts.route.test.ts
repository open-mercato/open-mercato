/** @jest-environment node */

/**
 * Regression coverage for #5669: the admin UI used to advertise the seeded demo
 * credentials from a hardcoded client constant, so an install started with
 * `--no-examples` — or an organization the examples were never seeded into —
 * still showed logins that do not exist. This endpoint is the data source that
 * replaced the constant, so it must report emptiness truthfully and stay scoped
 * to the caller's tenant and organization.
 *
 * The surfaces it feeds claim the credentials *work*, so existence alone is not
 * the predicate: an account that was deactivated, left unverified, or had its
 * password changed since seeding must drop out too.
 */

import { hashSync } from 'bcryptjs'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { EXAMPLE_PORTAL_ACCOUNTS } from '@open-mercato/core/modules/customer_accounts/lib/exampleAccounts'

const mockUserHasAllFeatures = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockFindWithDecryption = jest.fn()

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const staffUserId = '44444444-4444-4444-8444-444444444444'
const portalAdminRoleId = '55555555-5555-4555-8555-555555555555'

const mockEm = { id: 'em' }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'em') return mockEm
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const [alice, bob] = EXAMPLE_PORTAL_ACCOUNTS

function makeRequest(): Request {
  return new Request('http://localhost/api/customer_accounts/admin/demo-accounts')
}

// A low bcrypt cost keeps the suite fast; the route only ever compares, never hashes.
function makeSeededUser(email: string, id: string, storedPassword?: string) {
  const account = EXAMPLE_PORTAL_ACCOUNTS.find((entry) => entry.email === email)
  return {
    id,
    email,
    emailHash: hashForLookup(email),
    displayName: 'Seeded User',
    passwordHash: hashSync(storedPassword ?? account!.password, 4),
  }
}

function makeRoleLink(userId: string, deletedAt: Date | null = null) {
  return {
    user: { id: userId },
    role: { id: portalAdminRoleId, name: 'Portal Admin', slug: 'portal_admin', deletedAt },
  }
}

describe('admin demo portal accounts route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockGetAuthFromRequest.mockResolvedValue({
      sub: staffUserId,
      tenantId,
      orgId: organizationId,
    })
  })

  it('returns an empty list when example data was never seeded', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])
    const { GET } = await import('../demo-accounts')

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, items: [] })
    // No seeded user means no role lookup and, crucially, no password in the payload.
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(json)).not.toContain(alice.password)
  })

  it('returns only the seeded accounts that exist, with their real role names', async () => {
    const aliceUser = makeSeededUser(alice.email, '66666666-6666-4666-8666-666666666666')
    mockFindWithDecryption
      .mockResolvedValueOnce([aliceUser])
      .mockResolvedValueOnce([makeRoleLink(aliceUser.id)])
    const { GET } = await import('../demo-accounts')

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.items).toEqual([
      {
        email: alice.email,
        password: alice.password,
        roles: [{ id: portalAdminRoleId, name: 'Portal Admin', slug: 'portal_admin' }],
      },
    ])
    // The other seeded accounts are absent from this organization, so they are not advertised.
    expect(JSON.stringify(json)).not.toContain(bob.email)
  })

  it('reports an account with no role link rather than dropping it', async () => {
    const aliceUser = makeSeededUser(alice.email, '66666666-6666-4666-8666-666666666666')
    mockFindWithDecryption
      .mockResolvedValueOnce([aliceUser])
      .mockResolvedValueOnce([])
    const { GET } = await import('../demo-accounts')

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(json.items).toEqual([
      { email: alice.email, password: alice.password, roles: [] },
    ])
  })

  it('orders the response like the seed list regardless of row order', async () => {
    const aliceUser = makeSeededUser(alice.email, '66666666-6666-4666-8666-666666666666')
    const bobUser = makeSeededUser(bob.email, '77777777-7777-4777-8777-777777777777')
    mockFindWithDecryption
      .mockResolvedValueOnce([bobUser, aliceUser])
      .mockResolvedValueOnce([])
    const { GET } = await import('../demo-accounts')

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(json.items.map((item: { email: string }) => item.email)).toEqual([alice.email, bob.email])
  })

  it('does not advertise deactivated or unverified seeded accounts', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])
    const { GET } = await import('../demo-accounts')

    await GET(makeRequest())

    // Both are hard login guards in api/login.ts, so an account failing either one
    // cannot be logged into and must not be advertised as a working credential.
    const [, , where] = mockFindWithDecryption.mock.calls[0]
    expect(where.isActive).toBe(true)
    expect(where.emailVerifiedAt).toEqual({ $ne: null })
  })

  it('drops a seeded account whose password no longer matches the seeded credential', async () => {
    const aliceUser = makeSeededUser(alice.email, '66666666-6666-4666-8666-666666666666', 'ChangedByTheUser1!')
    mockFindWithDecryption.mockResolvedValueOnce([aliceUser])
    const { GET } = await import('../demo-accounts')

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(json).toEqual({ ok: true, items: [] })
    // A self-service password change makes the advertised credential a lie; the
    // row disappears instead of asserting a login that fails.
    expect(JSON.stringify(json)).not.toContain(alice.password)
    // No surviving account means the role lookup never runs.
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('omits a soft-deleted role from the reported role names', async () => {
    const aliceUser = makeSeededUser(alice.email, '66666666-6666-4666-8666-666666666666')
    mockFindWithDecryption
      .mockResolvedValueOnce([aliceUser])
      .mockResolvedValueOnce([makeRoleLink(aliceUser.id, new Date())])
    const { GET } = await import('../demo-accounts')

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(json.items).toEqual([
      { email: alice.email, password: alice.password, roles: [] },
    ])
  })

  it('scopes the lookup to the caller tenant and organization and skips soft-deleted rows', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])
    const { GET } = await import('../demo-accounts')

    await GET(makeRequest())

    const [, , where, , scope] = mockFindWithDecryption.mock.calls[0]
    expect(where).toEqual(expect.objectContaining({
      tenantId,
      organizationId,
      deletedAt: null,
    }))
    expect(where.emailHash.$in).toEqual(
      expect.arrayContaining(EXAMPLE_PORTAL_ACCOUNTS.map((account) => hashForLookup(account.email))),
    )
    expect(scope).toEqual({ tenantId, organizationId })
  })

  it('requires authentication', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce(null)
    const { GET } = await import('../demo-accounts')

    const response = await GET(makeRequest())

    expect(response.status).toBe(401)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('requires the customer_accounts.view feature', async () => {
    mockUserHasAllFeatures.mockResolvedValueOnce(false)
    const { GET } = await import('../demo-accounts')

    const response = await GET(makeRequest())

    expect(response.status).toBe(403)
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      staffUserId,
      ['customer_accounts.view'],
      { tenantId, organizationId },
    )
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })
})
