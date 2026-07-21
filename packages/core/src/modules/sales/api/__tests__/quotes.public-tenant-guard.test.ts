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
 */
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-for-public-quote-tenant-guard'

import { GET as getPublicQuote } from '@open-mercato/core/modules/sales/api/quotes/public/[token]/route'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { isForeignTenantActor, resolveActorTenantId } from '@open-mercato/core/modules/sales/lib/publicQuoteTenantScope'

const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const TENANT_B = '00000000-0000-4000-8000-00000000000b'
const TOKEN = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-0000000000ff'

const mockEm: Record<string, jest.Mock> = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => (token === 'em' ? mockEm : null),
  })),
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

function staffToken(payload: Record<string, unknown>) {
  return signJwt({ sub: USER_ID, email: 'staff@example.com', ...payload }, { audience: 'staff' })
}

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

describe('resolveActorTenantId / isForeignTenantActor', () => {
  test('falls back to actorTenantId when the selected tenant was nulled', () => {
    expect(resolveActorTenantId({ tenantId: null, actorTenantId: TENANT_B } as never)).toBe(TENANT_B)
  })

  test('prefers an explicit tenant selection over the actor home tenant', () => {
    expect(resolveActorTenantId({ tenantId: TENANT_A, actorTenantId: TENANT_B } as never)).toBe(TENANT_A)
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
})
