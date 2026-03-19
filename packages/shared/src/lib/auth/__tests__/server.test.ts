const cookieStore = { get: jest.fn() }
const cookiesMock = jest.fn(async () => cookieStore)
const verifyJwt = jest.fn()
const createRequestContainer = jest.fn()
const isAuthContextValid = jest.fn()

jest.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  verifyJwt: (...args: unknown[]) => verifyJwt(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/auth/lib/sessionIntegrity', () => ({
  isAuthContextValid: (...args: unknown[]) => isAuthContextValid(...args),
}))

const em = { id: 'em' }

describe('auth server integrity checks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    cookieStore.get.mockReset()
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? em : null),
    })
  })

  it('returns cookie auth only when the persisted auth context is still valid', async () => {
    const { getAuthFromCookies } = await import('@open-mercato/shared/lib/auth/server')
    const auth = {
      sub: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
      roles: [],
    }

    cookieStore.get.mockImplementation((name: string) => {
      if (name === 'auth_token') return { value: 'jwt-token' }
      return undefined
    })
    verifyJwt.mockReturnValue(auth)
    isAuthContextValid.mockResolvedValue(true)

    await expect(getAuthFromCookies()).resolves.toEqual(auth)
    expect(isAuthContextValid).toHaveBeenCalledWith(em, auth)
  })

  it('rejects stale request auth contexts before API handlers see them', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const auth = {
      sub: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
      roles: [],
    }

    verifyJwt.mockReturnValue(auth)
    isAuthContextValid.mockResolvedValue(false)

    const request = new Request('https://example.test/api/test', {
      headers: {
        cookie: 'auth_token=jwt-token',
      },
    })

    await expect(getAuthFromRequest(request)).resolves.toBeNull()
    expect(isAuthContextValid).toHaveBeenCalledWith(em, auth)
  })
})
