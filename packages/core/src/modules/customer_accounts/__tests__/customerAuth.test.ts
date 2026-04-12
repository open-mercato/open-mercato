const verifyJwt = jest.fn()
const createRequestContainer = jest.fn()
const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  verifyJwt: (...args: unknown[]) => verifyJwt(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/data/entities', () => ({
  CustomerUser: 'CustomerUser',
}))

jest.mock('@open-mercato/shared/lib/auth/featureMatch', () => ({
  hasAllFeatures: jest.fn(() => true),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('next/server', () => ({
  NextResponse: { json: jest.fn((body: unknown, init?: unknown) => ({ body, init })) },
}))

const em = {}

function makeRequest(token: string, via: 'cookie' | 'bearer' = 'cookie'): Request {
  const headers: Record<string, string> = via === 'cookie'
    ? { cookie: `customer_auth_token=${token}` }
    : { authorization: `Bearer ${token}` }
  return new Request('https://example.test/api/portal/test', { headers })
}

const validPayload = {
  sub: '11111111-1111-4111-8111-111111111111',
  type: 'customer',
  tenantId: '22222222-2222-4222-8222-222222222222',
  orgId: '33333333-3333-4333-8333-333333333333',
  email: 'customer@example.com',
  displayName: 'Test Customer',
  customerEntityId: null,
  personEntityId: null,
  resolvedFeatures: ['portal.view'],
  iat: 1000,
  exp: 9999999999,
}

describe('getCustomerAuthFromRequest — sessions_revoked_at check', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    createRequestContainer.mockResolvedValue({ resolve: () => em })
  })

  it('returns auth context when sessionsRevokedAt is null', async () => {
    const { getCustomerAuthFromRequest } = await import('../lib/customerAuth')

    verifyJwt.mockReturnValue(validPayload)
    findOneWithDecryptionMock.mockResolvedValue({ sessionsRevokedAt: null })

    const auth = await getCustomerAuthFromRequest(makeRequest('jwt-token'))
    expect(auth).not.toBeNull()
    expect(auth!.sub).toBe(validPayload.sub)
  })

  it('returns null when jwt.iat is before sessionsRevokedAt', async () => {
    const { getCustomerAuthFromRequest } = await import('../lib/customerAuth')

    verifyJwt.mockReturnValue({ ...validPayload, iat: 1000 })
    findOneWithDecryptionMock.mockResolvedValue({
      sessionsRevokedAt: new Date(2000 * 1000), // epoch 2000
    })

    const auth = await getCustomerAuthFromRequest(makeRequest('jwt-token'))
    expect(auth).toBeNull()
  })

  it('returns auth context when jwt.iat is after sessionsRevokedAt', async () => {
    const { getCustomerAuthFromRequest } = await import('../lib/customerAuth')

    verifyJwt.mockReturnValue({ ...validPayload, iat: 3000 })
    findOneWithDecryptionMock.mockResolvedValue({
      sessionsRevokedAt: new Date(2000 * 1000), // epoch 2000
    })

    const auth = await getCustomerAuthFromRequest(makeRequest('jwt-token'))
    expect(auth).not.toBeNull()
    expect(auth!.sub).toBe(validPayload.sub)
  })

  it('returns null when user is not found in DB', async () => {
    const { getCustomerAuthFromRequest } = await import('../lib/customerAuth')

    verifyJwt.mockReturnValue(validPayload)
    findOneWithDecryptionMock.mockResolvedValue(null)

    const auth = await getCustomerAuthFromRequest(makeRequest('jwt-token'))
    expect(auth).toBeNull()
  })

  it('returns null when container creation fails (fail-closed)', async () => {
    const { getCustomerAuthFromRequest } = await import('../lib/customerAuth')

    verifyJwt.mockReturnValue(validPayload)
    createRequestContainer.mockRejectedValue(new Error('DI unavailable'))

    const auth = await getCustomerAuthFromRequest(makeRequest('jwt-token'))
    expect(auth).toBeNull()
  })
})
