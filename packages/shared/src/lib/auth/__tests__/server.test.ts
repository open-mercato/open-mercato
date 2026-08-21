const cookieStore = { get: jest.fn() }
const cookiesMock = jest.fn(async () => cookieStore)
const verifyJwt = jest.fn()
const createRequestContainer = jest.fn()
const resolveCanonicalStaffAuthContext = jest.fn()
const findApiKeyBySecret = jest.fn()

jest.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/auth/jwt'),
  verifyJwt: (...args: unknown[]) => verifyJwt(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/auth/lib/sessionIntegrity', () => ({
  resolveCanonicalStaffAuthContext: (...args: unknown[]) => resolveCanonicalStaffAuthContext(...args),
}))

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: (...args: unknown[]) => findApiKeyBySecret(...args),
}))

const em = { id: 'em' }

describe('auth server integrity checks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    cookieStore.get.mockReset()
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return em
        return null
      },
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
    resolveCanonicalStaffAuthContext.mockResolvedValue(auth)

    await expect(getAuthFromCookies()).resolves.toEqual(auth)
    expect(resolveCanonicalStaffAuthContext).toHaveBeenCalledWith(em, auth)
  })

  it('rejects stale request auth contexts before API handlers see them', async () => {
    const { getAuthFromRequest, resolveAuthFromRequestDetailed } = await import('@open-mercato/shared/lib/auth/server')
    const auth = {
      sub: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
      roles: [],
    }

    verifyJwt.mockReturnValue(auth)
    resolveCanonicalStaffAuthContext.mockResolvedValue(null)

    const request = new Request('https://example.test/api/test', {
      headers: {
        cookie: 'auth_token=jwt-token',
      },
    })

    await expect(getAuthFromRequest(request)).resolves.toBeNull()
    await expect(resolveAuthFromRequestDetailed(request)).resolves.toEqual({ auth: null, status: 'invalid' })
    expect(resolveCanonicalStaffAuthContext).toHaveBeenCalledWith(em, auth)
  })

  it('replaces stale JWT roles with canonical roles from the database', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const jwtAuth = {
      sub: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
      roles: ['employee'],
    }
    const canonicalAuth = {
      ...jwtAuth,
      roles: ['admin'],
    }

    verifyJwt.mockReturnValue(jwtAuth)
    resolveCanonicalStaffAuthContext.mockResolvedValue(canonicalAuth)

    const request = new Request('https://example.test/api/test', {
      headers: {
        cookie: 'auth_token=jwt-token',
      },
    })

    await expect(getAuthFromRequest(request)).resolves.toEqual(canonicalAuth)
  })

  it('validates api key context before accepting api token auth', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    verifyJwt.mockImplementation(() => {
      throw new Error('no jwt')
    })
    findApiKeyBySecret.mockResolvedValue(null)

    const request = new Request('https://example.test/api/test', {
      headers: {
        'x-api-key': 'secret-key',
      },
    })

    await expect(getAuthFromRequest(request)).resolves.toBeNull()
  })

  describe('mfa-pending staff tokens', () => {
    const pendingAuth = {
      sub: '11111111-1111-4111-8111-111111111111',
      sid: '44444444-4444-4444-8444-444444444444',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
      roles: ['admin'],
      mfa_pending: true,
      mfa_verified: false,
    }

    function mfaPendingRequest(path: string, method: string): Request {
      return new Request(`https://example.test${path}`, {
        method,
        headers: { authorization: `Bearer pending-token` },
      })
    }

    beforeEach(() => {
      verifyJwt.mockReturnValue(pendingAuth)
      resolveCanonicalStaffAuthContext.mockResolvedValue({ ...pendingAuth })
    })

    it('rejects a pending token on a general staff API before roles are restored', async () => {
      const { resolveAuthFromRequestDetailed } = await import('@open-mercato/shared/lib/auth/server')

      await expect(resolveAuthFromRequestDetailed(mfaPendingRequest('/api/customers/people', 'GET')))
        .resolves.toEqual({ auth: null, status: 'invalid' })
      expect(resolveCanonicalStaffAuthContext).not.toHaveBeenCalled()
    })

    it('still resolves a pending token on the registered MFA completion routes (POST)', async () => {
      const { resolveAuthFromRequestDetailed } = await import('@open-mercato/shared/lib/auth/server')

      for (const path of ['/api/security/mfa/prepare', '/api/security/mfa/verify', '/api/security/mfa/recovery']) {
        resolveCanonicalStaffAuthContext.mockClear()
        const resolution = await resolveAuthFromRequestDetailed(mfaPendingRequest(path, 'POST'))
        expect(resolution.status).toBe('authenticated')
        expect(resolution.auth).toEqual({ ...pendingAuth })
        expect(resolveCanonicalStaffAuthContext).toHaveBeenCalledWith(em, pendingAuth)
      }
    })

    it('rejects a pending token with a non-completion method on a completion route', async () => {
      const { resolveAuthFromRequestDetailed } = await import('@open-mercato/shared/lib/auth/server')

      await expect(resolveAuthFromRequestDetailed(mfaPendingRequest('/api/security/mfa/verify', 'GET')))
        .resolves.toEqual({ auth: null, status: 'invalid' })
      expect(resolveCanonicalStaffAuthContext).not.toHaveBeenCalled()
    })

    it('resolves the verified replacement token like a normal login', async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      const verifiedAuth = { ...pendingAuth, mfa_pending: false, mfa_verified: true }
      verifyJwt.mockReturnValue(verifiedAuth)
      resolveCanonicalStaffAuthContext.mockResolvedValue({ ...verifiedAuth, roles: ['employee'] })

      const request = new Request('https://example.test/api/customers/people', {
        headers: { authorization: 'Bearer verified-token' },
      })

      await expect(getAuthFromRequest(request)).resolves.toEqual({ ...verifiedAuth, roles: ['employee'] })
      expect(resolveCanonicalStaffAuthContext).toHaveBeenCalledWith(em, verifiedAuth)
    })

    it('leaves tokens without MFA claims untouched', async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      const plainAuth = {
        sub: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        orgId: '33333333-3333-4333-8333-333333333333',
        roles: [],
      }
      verifyJwt.mockReturnValue(plainAuth)
      resolveCanonicalStaffAuthContext.mockResolvedValue(plainAuth)

      const request = new Request('https://example.test/api/test', {
        headers: { cookie: 'auth_token=jwt-token' },
      })

      await expect(getAuthFromRequest(request)).resolves.toEqual(plainAuth)
    })

    it('rejects a pending token from cookie-based page resolution unconditionally', async () => {
      const { getAuthFromCookies, resolveAuthFromCookiesDetailed } = await import('@open-mercato/shared/lib/auth/server')
      cookieStore.get.mockImplementation((name: string) => {
        if (name === 'auth_token') return { value: 'pending-jwt-token' }
        return undefined
      })

      await expect(getAuthFromCookies()).resolves.toBeNull()
      await expect(resolveAuthFromCookiesDetailed()).resolves.toEqual({ auth: null, status: 'invalid' })
      expect(resolveCanonicalStaffAuthContext).not.toHaveBeenCalled()
    })
  })
})
