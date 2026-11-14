/** @jest-environment node */
// Step 2.12 — D-R5-33 ("checkout session routes follow D-R5-21"): a session on an
// identified cart (`customerUserId` set) answers only to its own buyer's customer session
// on every `/sessions/current/*` route. `resolveCurrentSession` is the one seam both the
// `GET` and `PATCH /current` route files funnel through, mirroring `cart`'s own Step 2.9
// `resolveCurrentCart` test structure exactly (same two-phase peek-then-fetch shape, same
// "collapse to the SAME 404 as an unknown token" discipline, no enumeration oracle).

const mockGetCustomerAuthFromRequest = jest.fn()
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
}))

type FakeRow = Record<string, unknown>

function matchesWhere(row: FakeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    return row[key] === value
  })
}

let seededSessions: FakeRow[] = []

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
  return seededSessions.find((row) => matchesWhere(row, where)) ?? null
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) =>
    mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

const mockLookupCartPeerById = jest.fn()
jest.mock('../cartPeer', () => ({
  lookupCartPeerById: (...args: unknown[]) => mockLookupCartPeerById(...args),
}))

import { hashCheckoutSessionToken } from '../sessionToken'
import { resolveCurrentSession } from '../currentSessionRoute'

const TENANT_ID = 'tenant-session-bind-1'
const ORG_ID = 'org-session-bind-1'
const TOKEN = 'plain-session-token'

function makeFakeEm(): any {
  return {
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      return seededSessions.find((row) => matchesWhere(row, where)) ?? null
    }),
  }
}

function makeSessionRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'session-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    tokenHash: hashCheckoutSessionToken(TOKEN),
    customerUserId: null,
    status: 'open',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  seededSessions = []
  mockLookupCartPeerById.mockResolvedValue(null)
})

describe('resolveCurrentSession — D-R5-33 identity binding', () => {
  it('404-collapses when the token does not resolve any session, without ever decrypting', async () => {
    seededSessions = []
    const em = makeFakeEm()

    const result = await resolveCurrentSession(em, new Request('https://example.com'), TOKEN)

    expect(result.ok).toBe(false)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('a guest session (customerUserId null) stays fully token-only — no customer session required', async () => {
    seededSessions = [makeSessionRow({ customerUserId: null })]
    const em = makeFakeEm()

    const result = await resolveCurrentSession(em, new Request('https://example.com'), TOKEN)

    expect(result.ok).toBe(true)
    expect(mockGetCustomerAuthFromRequest).not.toHaveBeenCalled()
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('an identified session refuses a token-only anonymous request — same 404 as an unknown token', async () => {
    seededSessions = [makeSessionRow({ customerUserId: 'customer-user-owner' })]
    mockGetCustomerAuthFromRequest.mockResolvedValue(null)
    const em = makeFakeEm()

    const result = await resolveCurrentSession(em, new Request('https://example.com'), TOKEN)

    expect(result.ok).toBe(false)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it("an identified session refuses a DIFFERENT customer's valid session", async () => {
    seededSessions = [makeSessionRow({ customerUserId: 'customer-user-owner' })]
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-someone-else', type: 'customer' })
    const em = makeFakeEm()

    const result = await resolveCurrentSession(em, new Request('https://example.com'), TOKEN)

    expect(result.ok).toBe(false)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('an identified session succeeds for its own matching customer session', async () => {
    seededSessions = [makeSessionRow({ customerUserId: 'customer-user-owner' })]
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-owner', type: 'customer' })
    const em = makeFakeEm()

    const result = await resolveCurrentSession(em, new Request('https://example.com'), TOKEN)

    expect(result.ok).toBe(true)
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('scopes the full decrypted read to the SAME tenant/organization the token resolved (C21)', async () => {
    seededSessions = [makeSessionRow({ tenantId: 'tenant-other', organizationId: 'org-other', customerUserId: null })]
    const em = makeFakeEm()

    const result = await resolveCurrentSession(em, new Request('https://example.com'), TOKEN)

    expect(result.ok).toBe(true)
    const [, , where, , scope] = mockFindOneWithDecryption.mock.calls[0]
    expect(where).toMatchObject({ tenantId: 'tenant-other', organizationId: 'org-other' })
    expect(scope).toEqual({ tenantId: 'tenant-other', organizationId: 'org-other' })
  })

  // Finding 2: a guest session's cart claimed later at login (cart's merge 'replace'
  // strategy) updates the CART's own customer_user_id, never the session row that already
  // pointed at it. Binding must follow the LIVE cart, not the session's creation-time
  // snapshot — otherwise the bare token alone (no customer session required) keeps reading
  // PII / requesting quotes / buying on_account against whichever company claimed the cart.
  describe('Finding 2 — binds identity against the LIVE cart, not the session snapshot', () => {
    it('a session created as a guest (customerUserId null) whose cart was later claimed now requires that buyer\'s own customer session', async () => {
      seededSessions = [makeSessionRow({ customerUserId: null, cartId: 'cart-1' })]
      mockLookupCartPeerById.mockResolvedValue({ customerUserId: 'customer-user-claimed-later' })
      mockGetCustomerAuthFromRequest.mockResolvedValue(null)
      const em = makeFakeEm()

      const result = await resolveCurrentSession(em, new Request('https://example.com'), TOKEN)

      expect(result.ok).toBe(false)
      expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    })

    it('succeeds for the cart\'s current claimant even though the session snapshot is still a guest', async () => {
      seededSessions = [makeSessionRow({ customerUserId: null, cartId: 'cart-1' })]
      mockLookupCartPeerById.mockResolvedValue({ customerUserId: 'customer-user-claimed-later' })
      mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-claimed-later', type: 'customer' })
      const em = makeFakeEm()

      const result = await resolveCurrentSession(em, new Request('https://example.com'), TOKEN)

      expect(result.ok).toBe(true)
    })

    it('refuses the session snapshot\'s OWN stale customerUserId once the cart moved to a different buyer', async () => {
      seededSessions = [makeSessionRow({ customerUserId: 'customer-user-original', cartId: 'cart-1' })]
      mockLookupCartPeerById.mockResolvedValue({ customerUserId: 'customer-user-claimed-later' })
      // Presents the ORIGINAL session owner's own valid customer session — but the cart no
      // longer belongs to them.
      mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-original', type: 'customer' })
      const em = makeFakeEm()

      const result = await resolveCurrentSession(em, new Request('https://example.com'), TOKEN)

      expect(result.ok).toBe(false)
    })

    it('falls back to the session\'s own customerUserId when the cart peer cannot be read', async () => {
      seededSessions = [makeSessionRow({ customerUserId: 'customer-user-owner', cartId: 'cart-1' })]
      mockLookupCartPeerById.mockResolvedValue(null)
      mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-owner', type: 'customer' })
      const em = makeFakeEm()

      const result = await resolveCurrentSession(em, new Request('https://example.com'), TOKEN)

      expect(result.ok).toBe(true)
    })
  })
})
