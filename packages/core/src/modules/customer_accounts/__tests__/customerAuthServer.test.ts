/** @jest-environment node */
import { signAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'

const findActiveSessionForClaims = jest.fn()
const findOneWithDecryption = jest.fn()
const loadAcl = jest.fn()
const getEffectiveFeatures = jest.fn()
const cookies = jest.fn()
const mockEm = {}
const containerResolve = jest.fn()
const createRequestContainer = jest.fn(async () => ({
  resolve: (name: string) => containerResolve(name),
}))

jest.mock('next/headers', () => ({
  cookies: (...args: unknown[]) => cookies(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

const { getCustomerAuthFromCookies } = require('@open-mercato/core/modules/customer_accounts/lib/customerAuthServer') as typeof import('@open-mercato/core/modules/customer_accounts/lib/customerAuthServer')

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests'
})

const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const userId = 'uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu'
const tenantId = 'tttttttt-tttt-4ttt-8ttt-tttttttttttt'
const organizationId = 'oooooooo-oooo-4ooo-8ooo-oooooooooooo'

function setCustomerCookie(token: string): void {
  cookies.mockResolvedValue({
    get: (name: string) => name === 'customer_auth_token' ? { value: token } : undefined,
  })
}

function signCustomerToken(overrides: Record<string, unknown> = {}): string {
  return signAudienceJwt('customer', {
    sub: userId,
    sid: sessionId,
    type: 'customer',
    tenantId,
    orgId: organizationId,
    email: 'customer@example.test',
    displayName: 'Customer User',
    ...overrides,
  })
}

describe('getCustomerAuthFromCookies — session claim binding', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    containerResolve.mockImplementation((name: string) => {
      if (name === 'customerSessionService') return { findActiveSessionForClaims }
      if (name === 'customerRbacService') return { loadAcl, getEffectiveFeatures }
      if (name === 'em') return mockEm
      return null
    })
    findOneWithDecryption.mockResolvedValue({
      id: userId,
      tenantId,
      organizationId,
      customerEntityId: null,
      personEntityId: null,
      sessionsRevokedAt: null,
      deletedAt: null,
      isActive: true,
    })
    loadAcl.mockResolvedValue({ isPortalAdmin: false, features: ['portal.account.view'] })
    getEffectiveFeatures.mockResolvedValue(['portal.account.view'])
    findActiveSessionForClaims.mockResolvedValue({
      id: sessionId,
      deletedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
  })

  it('binds cookie authentication to the session owner and scope', async () => {
    setCustomerCookie(signCustomerToken())

    const result = await getCustomerAuthFromCookies()

    expect(result).toMatchObject({ sub: userId, sid: sessionId, tenantId, orgId: organizationId })
    expect(findActiveSessionForClaims).toHaveBeenCalledWith({
      sessionId,
      userId,
      tenantId,
      organizationId,
    })
  })

  it('rejects a token whose subject does not own the live session', async () => {
    const otherUserId = 'vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv'
    setCustomerCookie(signCustomerToken({ sub: otherUserId }))
    findActiveSessionForClaims.mockResolvedValueOnce(null)

    await expect(getCustomerAuthFromCookies()).resolves.toBeNull()
    expect(findActiveSessionForClaims).toHaveBeenCalledWith({
      sessionId,
      userId: otherUserId,
      tenantId,
      organizationId,
    })
  })

  it('re-derives customerEntityId/personEntityId from the DB record, not the token (#2244)', async () => {
    const dbCustomerEntityId = 'dbdbdbdb-dbdb-4dbd-8dbd-dbdbdbdbdbdb'
    findOneWithDecryption.mockResolvedValueOnce({
      id: userId,
      tenantId,
      organizationId,
      customerEntityId: dbCustomerEntityId,
      personEntityId: null,
      sessionsRevokedAt: null,
      deletedAt: null,
      isActive: true,
    })
    const forgedCustomerEntityId = 'fafafafa-fafa-4afa-8afa-fafafafafafa'
    setCustomerCookie(signCustomerToken({ customerEntityId: forgedCustomerEntityId }))

    const result = await getCustomerAuthFromCookies()

    expect(result).not.toBeNull()
    expect(result!.customerEntityId).toBe(dbCustomerEntityId)
    expect(result!.customerEntityId).not.toBe(forgedCustomerEntityId)
  })

  it('rejects a token whose claimed tenant/org no longer matches the persisted record (#2244)', async () => {
    const otherTenantId = 'ssssssss-ssss-4sss-8sss-ssssssssssss'
    findOneWithDecryption.mockResolvedValueOnce({
      id: userId,
      tenantId: otherTenantId,
      organizationId,
      customerEntityId: null,
      personEntityId: null,
      sessionsRevokedAt: null,
      deletedAt: null,
      isActive: true,
    })
    setCustomerCookie(signCustomerToken())

    await expect(getCustomerAuthFromCookies()).resolves.toBeNull()
  })
})
