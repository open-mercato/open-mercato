/** @jest-environment node */
/**
 * Regression coverage for #4309 — the "different tenant" guard on the public quote endpoint.
 *
 * The pre-existing tenant-isolation tests in `quotes.acceptance.test.ts` mock `getAuthFromRequest`
 * outright, so they only ever assert the one auth shape (`{ tenantId: OTHER_TENANT_ID }`) that
 * never occurs in the failing scenario. These tests deliberately do NOT mock the auth module: they
 * build real signed JWTs in a real `cookie` header and let `resolveAuthFromRequestDetailed` and
 * `applySuperAdminScope` run, so the null-tenant envelope that defeated the guard is produced by
 * the actual code instead of by a hand-written mock.
 *
 * Scope caveat: only the database round-trip is stubbed. `resolveCanonicalStaffAuthContext` is
 * mocked to echo its input, which also bypasses session binding — the tokens below carry no `sid`,
 * so real production auth would reject them. This is route-level coverage of the tenant guard, not
 * end-to-end authentication coverage.
 */
import { GET as getPublicQuote } from '@open-mercato/core/modules/sales/api/quotes/public/[token]/route'
import { POST as acceptQuote } from '@open-mercato/core/modules/sales/api/quotes/accept/route'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { isForeignTenantActor, resolveEffectiveTenantId } from '@open-mercato/core/modules/sales/lib/publicQuoteTenantScope'

const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const TENANT_B = '00000000-0000-4000-8000-00000000000b'
const TOKEN = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-0000000000ff'

const mockCommandBus = { execute: jest.fn() }
const mockEm: Record<string, jest.Mock> = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
  transactional: jest.fn().mockImplementation(async (callback: (trx: unknown) => Promise<unknown>) => callback(mockEm)),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      if (token === 'commandBus') return mockCommandBus
      return null
    },
  })),
}))

jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: jest.fn(() => null),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  detectLocale: jest.fn().mockResolvedValue('en'),
}))

// Only the database round-trip is stubbed; cookie parsing, JWT verification and the
// superadmin tenant-scope rewrite all run for real.
jest.mock('@open-mercato/core/modules/auth/lib/sessionIntegrity', () => ({
  resolveCanonicalStaffAuthContext: jest.fn(async (_em: unknown, auth: unknown) => auth),
}))

const quote = {
  id: 'q-4309',
  tenantId: TENANT_A,
  quoteNumber: 'SQ-4309',
  currencyCode: 'USD',
  status: 'sent',
  validFrom: null,
  validUntil: null,
  subtotalNetAmount: '0',
  subtotalGrossAmount: '0',
  discountTotalAmount: '0',
  taxTotalAmount: '0',
  grandTotalNetAmount: '0',
  grandTotalGrossAmount: '0',
}

function makeRequest(cookie?: string) {
  return new Request(`http://localhost/api/sales/quotes/public/${TOKEN}`, {
    headers: cookie ? { cookie } : {},
  })
}

function makeCtx() {
  return { params: { token: TOKEN } } as never
}

function makeAcceptRequest(cookie?: string) {
  return new Request('http://localhost/api/sales/quotes/accept', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ token: TOKEN }),
  })
}

function staffToken(payload: Record<string, unknown>) {
  return signJwt({ sub: USER_ID, email: 'staff@example.com', ...payload }, { audience: 'staff' })
}

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-for-public-quote-tenant-guard'
})

beforeEach(() => {
  jest.clearAllMocks()
  mockEm.fork.mockReturnValue(mockEm)
  mockEm.findOne.mockResolvedValue({ ...quote })
  mockEm.find.mockResolvedValue([])
})

describe('public quote view — tenant guard against the real auth resolver (#4309)', () => {
  test('anonymous request still returns the quote (public link is intentional)', async () => {
    const res = await getPublicQuote(makeRequest(), makeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quote.quoteNumber).toBe('SQ-4309')
  })

  test('same-tenant staff session returns the quote', async () => {
    const cookie = `auth_token=${staffToken({ tenantId: TENANT_A, orgId: null })}`
    const res = await getPublicQuote(makeRequest(cookie), makeCtx())
    expect(res.status).toBe(200)
  })

  test('cross-tenant staff session is rejected with 404', async () => {
    const cookie = `auth_token=${staffToken({ tenantId: TENANT_B, orgId: null })}`
    const res = await getPublicQuote(makeRequest(cookie), makeCtx())
    expect(res.status).toBe(404)
  })

  // The reported repro: a superadmin session scoped to "all tenants" carries an EMPTY
  // om_selected_tenant cookie, which `applySuperAdminScope` turns into `tenantId: null` while
  // preserving the real tenant under `actorTenantId`. The old `auth?.tenantId &&` precondition
  // read that as "tenant unknown → allow" and skipped the comparison entirely.
  test('cross-tenant superadmin scoped to all tenants is rejected with 404', async () => {
    const token = staffToken({ tenantId: TENANT_B, orgId: null, isSuperAdmin: true })
    const res = await getPublicQuote(makeRequest(`auth_token=${token}; om_selected_tenant=`), makeCtx())
    expect(res.status).toBe(404)
  })

  test('superadmin explicitly scoped to the owning tenant still sees the quote', async () => {
    const token = staffToken({ tenantId: TENANT_B, orgId: null, isSuperAdmin: true })
    const res = await getPublicQuote(
      makeRequest(`auth_token=${token}; om_selected_tenant=${TENANT_A}`),
      makeCtx(),
    )
    expect(res.status).toBe(200)
  })
})

describe('quote acceptance — tenant scoping stays aligned with the view guard (#4309)', () => {
  // The accept lookup filters by tenant, so a cross-tenant session finds no row. These assert the
  // scoping decision itself, which the pre-existing accept tests never exercise for a null tenant.
  function captureLookupTenant() {
    const seen: Array<unknown> = []
    mockEm.findOne.mockImplementation(async (_cls: unknown, where: Record<string, unknown>) => {
      seen.push(where?.tenantId)
      const scoped = where?.tenantId
      if (scoped !== undefined && scoped !== TENANT_A) return null
      return { ...quote }
    })
    return seen
  }

  test('anonymous acceptance is left unscoped', async () => {
    const seen = captureLookupTenant()
    await acceptQuote(makeAcceptRequest())
    expect(seen[0]).toBeUndefined()
  })

  test('same-tenant staff acceptance scopes the lookup to that tenant', async () => {
    const seen = captureLookupTenant()
    await acceptQuote(makeAcceptRequest(`auth_token=${staffToken({ tenantId: TENANT_A, orgId: null })}`))
    expect(seen[0]).toBe(TENANT_A)
  })

  test('cross-tenant staff acceptance is rejected with 404', async () => {
    captureLookupTenant()
    const res = await acceptQuote(makeAcceptRequest(`auth_token=${staffToken({ tenantId: TENANT_B, orgId: null })}`))
    expect(res.status).toBe(404)
  })

  // Previously this succeeded: tenantId was null, so no scoping was applied and the unscoped
  // lookup converted a foreign-tenant quote into an order.
  test('cross-tenant superadmin scoped to all tenants is rejected with 404', async () => {
    captureLookupTenant()
    const token = staffToken({ tenantId: TENANT_B, orgId: null, isSuperAdmin: true })
    const res = await acceptQuote(makeAcceptRequest(`auth_token=${token}; om_selected_tenant=`))
    expect(res.status).toBe(404)
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })
})

describe('resolveEffectiveTenantId / isForeignTenantActor', () => {
  test('falls back to actorTenantId when the selected tenant was nulled', () => {
    expect(resolveEffectiveTenantId({ tenantId: null, actorTenantId: TENANT_B } as never)).toBe(TENANT_B)
  })

  test('prefers an explicit tenant selection over the actor home tenant', () => {
    expect(resolveEffectiveTenantId({ tenantId: TENANT_A, actorTenantId: TENANT_B } as never)).toBe(TENANT_A)
  })

  test('an explicitly selected tenant is not foreign', () => {
    expect(isForeignTenantActor({ tenantId: TENANT_A, actorTenantId: TENANT_B } as never, TENANT_A)).toBe(false)
  })

  test('anonymous requests are never foreign', () => {
    expect(isForeignTenantActor(null, TENANT_A)).toBe(false)
  })

  test('a null actor tenant does not silently pass the guard', () => {
    expect(isForeignTenantActor({ tenantId: null, actorTenantId: null } as never, TENANT_A)).toBe(true)
  })

  test('tenant comparison ignores case and surrounding whitespace', () => {
    expect(isForeignTenantActor({ tenantId: ` ${TENANT_A.toUpperCase()} ` } as never, TENANT_A)).toBe(false)
  })

  // ApiKey.tenantId is nullable, so a global key legitimately resolves to no tenant. Denying it
  // would reject a caller strictly more privileged than the anonymous one the link already serves.
  test('a tenant-less API key is not foreign', () => {
    expect(isForeignTenantActor({ isApiKey: true, tenantId: null } as never, TENANT_A)).toBe(false)
  })

  test('a tenant-scoped API key is still held to its tenant', () => {
    expect(isForeignTenantActor({ isApiKey: true, tenantId: TENANT_B } as never, TENANT_A)).toBe(true)
  })

  // The om_selected_tenant cookie is copied verbatim by applySuperAdminScope, so a malformed
  // value must not reach a uuid column filter.
  test('a malformed tenant value is unresolvable rather than passed through', () => {
    expect(resolveEffectiveTenantId({ tenantId: 'not-a-uuid', actorTenantId: TENANT_B } as never)).toBe(TENANT_B)
    expect(resolveEffectiveTenantId({ tenantId: 'not-a-uuid' } as never)).toBeNull()
  })
})
