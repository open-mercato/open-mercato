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

  it('reports a transient DB failure as "error", never "invalid" (issue #4176 — no mass logout)', async () => {
    const { resolveAuthFromRequestDetailed, resolveAuthFromCookiesDetailed } = await import('@open-mercato/shared/lib/auth/server')
    const auth = {
      sub: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
      roles: [],
    }

    verifyJwt.mockReturnValue(auth)
    // A DB blip / pool exhaustion / timeout throws from the canonical lookup.
    resolveCanonicalStaffAuthContext.mockRejectedValue(new Error('connection pool exhausted'))

    const request = new Request('https://example.test/api/test', {
      headers: { cookie: 'auth_token=jwt-token' },
    })

    await expect(resolveAuthFromRequestDetailed(request)).resolves.toEqual({ auth: null, status: 'error' })

    cookieStore.get.mockImplementation((name: string) => {
      if (name === 'auth_token') return { value: 'jwt-token' }
      return undefined
    })
    await expect(resolveAuthFromCookiesDetailed()).resolves.toEqual({ auth: null, status: 'error' })
  })

  it('still reports a genuinely bad token as "invalid" when it throws during verify', async () => {
    const { resolveAuthFromRequestDetailed } = await import('@open-mercato/shared/lib/auth/server')
    verifyJwt.mockImplementation(() => {
      throw new Error('malformed token')
    })

    const request = new Request('https://example.test/api/test', {
      headers: { cookie: 'auth_token=jwt-token' },
    })

    await expect(resolveAuthFromRequestDetailed(request)).resolves.toEqual({ auth: null, status: 'invalid' })
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

  it('reports a transient DB failure on the api-key path as "error" (retryable 503)', async () => {
    const { resolveAuthFromRequestDetailed } = await import('@open-mercato/shared/lib/auth/server')
    // Distinct secret so the shared api-key auth cache does not serve a prior miss.
    findApiKeyBySecret.mockRejectedValue(Object.assign(new Error('sorry, too many clients already'), { code: '53300' }))

    const request = new Request('https://example.test/api/test', {
      headers: { 'x-api-key': 'transient-key' },
    })

    await expect(resolveAuthFromRequestDetailed(request)).resolves.toEqual({ auth: null, status: 'error' })
  })

  it('keeps a non-transient api-key failure as "missing" (unchanged 401 behavior)', async () => {
    const { resolveAuthFromRequestDetailed } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockRejectedValue(new Error('unexpected non-db failure'))

    const request = new Request('https://example.test/api/test', {
      headers: { 'x-api-key': 'non-transient-key' },
    })

    await expect(resolveAuthFromRequestDetailed(request)).resolves.toEqual({ auth: null, status: 'missing' })
  })
})

describe('super-admin tenant cookie override', () => {
  const ACTOR_TENANT = '22222222-2222-4222-8222-222222222222'
  const OTHER_TENANT = '44444444-4444-4444-8444-444444444444'

  const superAdminAuth = {
    sub: '11111111-1111-4111-8111-111111111111',
    tenantId: ACTOR_TENANT,
    orgId: '33333333-3333-4333-8333-333333333333',
    roles: ['superadmin'],
    isSuperAdmin: true,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    cookieStore.get.mockReset()
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? em : null),
    })
    verifyJwt.mockReturnValue(superAdminAuth)
    resolveCanonicalStaffAuthContext.mockResolvedValue(superAdminAuth)
  })

  async function authFor(cookie: string) {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    return getAuthFromRequest(new Request('https://example.test/api/test', { headers: { cookie } }))
  }

  it.each([
    ['blank', 'om_selected_tenant='],
    ['whitespace-only', 'om_selected_tenant=%20%20'],
  ])('treats a %s tenant cookie as no selection and keeps the tenant from the token', async (_label, tenantCookie) => {
    const auth = await authFor(`auth_token=jwt-token; ${tenantCookie}`)

    expect(auth?.tenantId).toBe(ACTOR_TENANT)
    expect(auth).not.toHaveProperty('actorTenantId')
  })

  it('still applies a concrete tenant selection and preserves the actor tenant', async () => {
    const auth = await authFor(`auth_token=jwt-token; om_selected_tenant=${OTHER_TENANT}`)

    expect(auth?.tenantId).toBe(OTHER_TENANT)
    expect((auth as { actorTenantId?: string | null }).actorTenantId).toBe(ACTOR_TENANT)
  })

  it('leaves the organization override working when the tenant cookie is blank', async () => {
    const auth = await authFor('auth_token=jwt-token; om_selected_tenant=; om_selected_org=__all__')

    expect(auth?.tenantId).toBe(ACTOR_TENANT)
    expect(auth?.orgId).toBeNull()
    expect((auth as { actorOrgId?: string | null }).actorOrgId).toBe(superAdminAuth.orgId)
  })

  it('leaves a non-super-admin session untouched by a blank tenant cookie', async () => {
    const staffAuth = { ...superAdminAuth, roles: ['employee'], isSuperAdmin: false }
    verifyJwt.mockReturnValue(staffAuth)
    resolveCanonicalStaffAuthContext.mockResolvedValue(staffAuth)

    await expect(authFor('auth_token=jwt-token; om_selected_tenant=')).resolves.toEqual(staffAuth)
  })
})
