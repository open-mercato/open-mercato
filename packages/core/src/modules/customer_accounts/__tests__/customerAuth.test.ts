/** @jest-environment node */
import {
  signAudienceJwt,
  signJwt,
} from '@open-mercato/shared/lib/auth/jwt'

const findActiveSessionForClaims = jest.fn()
const findOneWithDecryption = jest.fn()
const loadAcl = jest.fn()
const getEffectiveFeatures = jest.fn()
const mockEm = {}
const containerResolve = jest.fn()
const createRequestContainer = jest.fn(async () => ({
  resolve: (name: string) => containerResolve(name),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

// Import after mocks are set up.
const { getCustomerAuthFromRequest } = require('@open-mercato/core/modules/customer_accounts/lib/customerAuth') as typeof import('@open-mercato/core/modules/customer_accounts/lib/customerAuth')

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests'
})

const CUSTOMER_AUDIENCE = 'customer'
const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const userId = 'uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu'
const tenantId = 'tttttttt-tttt-4ttt-8ttt-tttttttttttt'
const orgId = 'oooooooo-oooo-4ooo-8ooo-oooooooooooo'

function buildCustomerCookieHeader(token: string): string {
  return `customer_auth_token=${token}`
}

function buildCustomerPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: userId,
    sid: sessionId,
    type: 'customer',
    tenantId,
    orgId,
    email: 'customer@example.test',
    displayName: 'Customer User',
    resolvedFeatures: ['customer_portal.view'],
    ...overrides,
  }
}

describe('getCustomerAuthFromRequest — session revocation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    containerResolve.mockImplementation((name: string) => {
      if (name === 'customerSessionService') {
        return { findActiveSessionForClaims }
      }
      if (name === 'customerRbacService') {
        return { loadAcl, getEffectiveFeatures }
      }
      if (name === 'em') return mockEm
      return null
    })
    findOneWithDecryption.mockResolvedValue({
      id: userId,
      sessionsRevokedAt: null,
      deletedAt: null,
      isActive: true,
    })
    loadAcl.mockResolvedValue({ isPortalAdmin: false, features: ['customer_portal.view'] })
    getEffectiveFeatures.mockResolvedValue(['customer_portal.view'])
    findActiveSessionForClaims.mockResolvedValue({
      id: sessionId,
      deletedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
  })

  it('accepts a valid customer token and looks up the referenced session', async () => {
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, buildCustomerPayload())
    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })

    const result = await getCustomerAuthFromRequest(req)

    expect(result).toMatchObject({ sub: userId, sid: sessionId, type: 'customer' })
    expect(findActiveSessionForClaims).toHaveBeenCalledWith({
      sessionId,
      userId,
      tenantId,
      organizationId: orgId,
    })
  })

  it('rejects a valid session id when it belongs to a different customer identity or scope', async () => {
    const otherUserId = 'vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv'
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, buildCustomerPayload({ sub: otherUserId }))
    findActiveSessionForClaims.mockResolvedValueOnce(null)
    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })

    await expect(getCustomerAuthFromRequest(req)).resolves.toBeNull()
    expect(findActiveSessionForClaims).toHaveBeenCalledWith({
      sessionId,
      userId: otherUserId,
      tenantId,
      organizationId: orgId,
    })
  })

  it('rejects the token once the underlying session row has been revoked', async () => {
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, buildCustomerPayload())
    findActiveSessionForClaims.mockResolvedValueOnce(null)

    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })

    await expect(getCustomerAuthFromRequest(req)).resolves.toBeNull()
  })

  it('rejects tokens that are missing the sid claim so legacy/stolen tokens cannot survive the fix', async () => {
    const payload = buildCustomerPayload()
    delete payload.sid
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, payload)

    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })

    await expect(getCustomerAuthFromRequest(req)).resolves.toBeNull()
    expect(findActiveSessionForClaims).not.toHaveBeenCalled()
  })

  it('rejects staff JWTs replayed on the customer portal cookie', async () => {
    // A staff JWT is signed with the staff audience secret and carries aud=staff. Even if an
    // attacker copies it into the `customer_auth_token` cookie, the verifier must refuse it.
    const staffToken = signJwt({
      sub: userId,
      sid: sessionId,
      tenantId,
      orgId,
      email: 'staff@example.test',
      roles: ['admin'],
    })
    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(staffToken) },
    })

    await expect(getCustomerAuthFromRequest(req)).resolves.toBeNull()
    expect(findActiveSessionForClaims).not.toHaveBeenCalled()
  })

  it('fails closed when session lookup throws (degraded backend)', async () => {
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, buildCustomerPayload())
    findActiveSessionForClaims.mockRejectedValueOnce(new Error('db unavailable'))

    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })

    await expect(getCustomerAuthFromRequest(req)).resolves.toBeNull()
  })

  it('rejects tokens for soft-deleted users', async () => {
    findOneWithDecryption.mockResolvedValueOnce({
      id: userId,
      sessionsRevokedAt: null,
      deletedAt: new Date(),
      isActive: true,
    })
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, buildCustomerPayload())
    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })

    await expect(getCustomerAuthFromRequest(req)).resolves.toBeNull()
  })

  it('rejects tokens for deactivated users', async () => {
    findOneWithDecryption.mockResolvedValueOnce({
      id: userId,
      sessionsRevokedAt: null,
      deletedAt: null,
      isActive: false,
    })
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, buildCustomerPayload())
    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })

    await expect(getCustomerAuthFromRequest(req)).resolves.toBeNull()
  })

  it('resolves features from DB instead of trusting JWT claims', async () => {
    loadAcl.mockResolvedValueOnce({ isPortalAdmin: false, features: ['portal.orders.view'] })
    getEffectiveFeatures.mockResolvedValueOnce(['portal.orders.view'])
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, buildCustomerPayload({
      resolvedFeatures: ['portal.admin.all', 'portal.users.manage'],
    }))
    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })

    const result = await getCustomerAuthFromRequest(req)

    expect(result).not.toBeNull()
    expect(result!.resolvedFeatures).toEqual(['portal.orders.view'])
    expect(result!.resolvedFeatures).not.toContain('portal.admin.all')
    expect(result!.resolvedFeatures).not.toContain('portal.users.manage')
  })

  it('returns concrete effective features and admin status for portal admins', async () => {
    loadAcl.mockResolvedValueOnce({ isPortalAdmin: true, features: ['portal.orders.view'] })
    getEffectiveFeatures.mockResolvedValueOnce(['portal.orders.view'])
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, buildCustomerPayload())
    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })

    const result = await getCustomerAuthFromRequest(req)

    expect(result).not.toBeNull()
    expect(result!.resolvedFeatures).toEqual(['portal.orders.view'])
    expect(result!.isPortalAdmin).toBe(true)
  })
})

describe('getCustomerAuthFromRequest — legacy raw-secret tokens', () => {
  const originalGrace = process.env.JWT_LEGACY_GRACE_MINUTES
  const originalCutover = process.env.JWT_LEGACY_CUTOVER_AT
  const rawSecret = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests'

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.JWT_LEGACY_GRACE_MINUTES
    process.env.JWT_LEGACY_CUTOVER_AT = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    containerResolve.mockImplementation((name: string) => {
      if (name === 'customerSessionService') return { findActiveSessionForClaims }
      if (name === 'customerRbacService') return { loadAcl, getEffectiveFeatures }
      if (name === 'em') return mockEm
      return null
    })
    findOneWithDecryption.mockResolvedValue({
      id: userId,
      sessionsRevokedAt: null,
      deletedAt: null,
      isActive: true,
    })
    loadAcl.mockResolvedValue({ isPortalAdmin: false, features: ['customer_portal.view'] })
    getEffectiveFeatures.mockResolvedValue(['customer_portal.view'])
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalGrace === undefined) delete process.env.JWT_LEGACY_GRACE_MINUTES
    else process.env.JWT_LEGACY_GRACE_MINUTES = originalGrace
    if (originalCutover === undefined) delete process.env.JWT_LEGACY_CUTOVER_AT
    else process.env.JWT_LEGACY_CUTOVER_AT = originalCutover
  })

  function buildLegacyRequest(): Request {
    // Pre-migration shape: signed with the raw JWT_SECRET, no aud/iss, no sid. A long TTL keeps
    // `exp` valid so these tests exercise the grace window rather than ordinary expiry.
    const payload = buildCustomerPayload()
    delete payload.sid
    const token = signJwt(payload, rawSecret, 30 * 24 * 3600)
    return new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })
  }

  it('accepts a sessionless legacy token while it is inside the grace window', async () => {
    process.env.JWT_LEGACY_GRACE_MINUTES = '60'
    const req = buildLegacyRequest()

    const result = await getCustomerAuthFromRequest(req)

    expect(result).toMatchObject({ sub: userId, type: 'customer' })
    expect(findActiveSessionForClaims).not.toHaveBeenCalled()
  })

  it('rejects the same sessionless legacy token once the grace window has passed', async () => {
    process.env.JWT_LEGACY_GRACE_MINUTES = '60'
    const req = buildLegacyRequest()
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 60 * 1000)

    await expect(getCustomerAuthFromRequest(req)).resolves.toBeNull()
  })

  it('rejects sessionless legacy tokens outright when the grace window is disabled', async () => {
    process.env.JWT_LEGACY_GRACE_MINUTES = '0'
    const req = buildLegacyRequest()

    await expect(getCustomerAuthFromRequest(req)).resolves.toBeNull()
  })
})
