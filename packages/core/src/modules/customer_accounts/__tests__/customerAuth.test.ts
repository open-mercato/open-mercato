/** @jest-environment node */
import {
  signAudienceJwt,
  signJwt,
} from '@open-mercato/shared/lib/auth/jwt'

const findActiveSessionById = jest.fn()
const findOneWithDecryption = jest.fn()
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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getCustomerAuthFromRequest } = require('@open-mercato/core/modules/customer_accounts/lib/customerAuth') as typeof import('@open-mercato/core/modules/customer_accounts/lib/customerAuth')

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
        return { findActiveSessionById }
      }
      if (name === 'em') return mockEm
      return null
    })
    findOneWithDecryption.mockResolvedValue({ id: userId, sessionsRevokedAt: null })
    findActiveSessionById.mockResolvedValue({
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
    expect(findActiveSessionById).toHaveBeenCalledWith(sessionId)
  })

  it('rejects the token once the underlying session row has been revoked', async () => {
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, buildCustomerPayload())
    findActiveSessionById.mockResolvedValueOnce(null)

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
    expect(findActiveSessionById).not.toHaveBeenCalled()
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
    expect(findActiveSessionById).not.toHaveBeenCalled()
  })

  it('fails closed when session lookup throws (degraded backend)', async () => {
    const token = signAudienceJwt(CUSTOMER_AUDIENCE, buildCustomerPayload())
    findActiveSessionById.mockRejectedValueOnce(new Error('db unavailable'))

    const req = new Request('http://localhost/api/customer/me', {
      headers: { cookie: buildCustomerCookieHeader(token) },
    })

    await expect(getCustomerAuthFromRequest(req)).resolves.toBeNull()
  })
})
