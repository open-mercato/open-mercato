const verifyJwt = jest.fn(() => {
  throw new Error('no jwt')
})
const createRequestContainer = jest.fn()
const findApiKeyBySecret = jest.fn()
const emFind = jest.fn()
const emFindOne = jest.fn()
const emPersist = jest.fn()
const emFlush = jest.fn()

jest.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  verifyJwt: (...args: unknown[]) => verifyJwt(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/auth/lib/sessionIntegrity', () => ({
  resolveCanonicalStaffAuthContext: jest.fn(async (_em: unknown, auth: unknown) => auth),
}))

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: (...args: unknown[]) => findApiKeyBySecret(...args),
}))

jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({
  Role: class {},
  RoleAcl: class {},
  User: class {},
}))

jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({
  Organization: class {},
  Tenant: class {},
}))

const em = {
  find: (...args: unknown[]) => emFind(...args),
  findOne: (...args: unknown[]) => emFindOne(...args),
  persist: (...args: unknown[]) => {
    emPersist(...args)
    return { flush: (...flushArgs: unknown[]) => emFlush(...flushArgs) }
  },
  flush: (...args: unknown[]) => emFlush(...args),
}

describe('resolveApiKeyAuth caching + lastUsedAt debounce', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? em : null),
    })
    emFind.mockResolvedValue([])
    emFindOne.mockResolvedValue(null)
    emPersist.mockReturnValue(undefined)
    emFlush.mockResolvedValue(undefined)
    const { resetSharedApiKeyAuthCacheForTests } = await import('@open-mercato/shared/lib/auth/apiKeyAuthCache')
    resetSharedApiKeyAuthCacheForTests()
  })

  function buildRequest(secret: string): Request {
    return new Request('https://example.test/api/test', {
      headers: { 'x-api-key': secret },
    })
  }

  it('serves repeated requests from cache without re-hitting findApiKeyBySecret', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue({
      id: 'key-cache-1',
      name: 'cached',
      tenantId: null,
      organizationId: null,
      rolesJson: [],
      sessionUserId: null,
      createdBy: null,
      expiresAt: null,
      lastUsedAt: null,
    })

    const first = await getAuthFromRequest(buildRequest('cache-secret-1'))
    const second = await getAuthFromRequest(buildRequest('cache-secret-1'))
    const third = await getAuthFromRequest(buildRequest('cache-secret-1'))

    expect(first).toMatchObject({ isApiKey: true, keyId: 'key-cache-1' })
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(findApiKeyBySecret).toHaveBeenCalledTimes(1)
    expect(emFlush).toHaveBeenCalledTimes(1)
  })

  it('retains the creator identity for a regular tenant-scoped key', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue({
      id: 'key-tenant-scoped',
      name: 'tenant scoped',
      tenantId: 'tenant-1',
      organizationId: null,
      rolesJson: [],
      sessionToken: null,
      sessionUserId: null,
      sessionSecretEncrypted: null,
      opencodeSessionId: null,
      createdBy: 'creator-1',
      expiresAt: null,
      lastUsedAt: null,
    })
    emFindOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === 'tenant-1' && where.isActive === true) return { id: 'tenant-1' }
      if (where.id === 'creator-1') {
        return { id: 'creator-1', tenantId: 'tenant-1', organizationId: 'creator-org' }
      }
      return null
    })

    const auth = await getAuthFromRequest(buildRequest('tenant-scoped-secret'))

    expect(auth).toMatchObject({
      sub: 'api_key:key-tenant-scoped',
      tenantId: 'tenant-1',
      orgId: null,
      isApiKey: true,
      keyId: 'key-tenant-scoped',
      userId: 'creator-1',
    })
    // The creator remains the key's legacy identity, but its concrete
    // organization does not narrow a tenant-scoped key.
    expect(emFindOne).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'creator-1', deletedAt: null },
    )
  })

  it('rejects a tenant-scoped regular key once its creator is soft-deleted', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue({
      id: 'key-deleted-creator',
      name: 'deleted creator',
      tenantId: 'tenant-1',
      organizationId: null,
      rolesJson: [],
      sessionToken: null,
      sessionUserId: null,
      sessionSecretEncrypted: null,
      opencodeSessionId: null,
      createdBy: 'creator-1',
      expiresAt: null,
      lastUsedAt: null,
    })
    emFindOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === 'tenant-1' && where.isActive === true) return { id: 'tenant-1' }
      return null
    })

    await expect(
      getAuthFromRequest(buildRequest('deleted-creator-secret')),
    ).resolves.toBeNull()
  })

  it('rejects a tenant-scoped regular key whose creator moved to another tenant', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue({
      id: 'key-foreign-creator',
      name: 'foreign creator',
      tenantId: 'tenant-1',
      organizationId: null,
      rolesJson: [],
      sessionToken: null,
      sessionUserId: null,
      sessionSecretEncrypted: null,
      opencodeSessionId: null,
      createdBy: 'creator-1',
      expiresAt: null,
      lastUsedAt: null,
    })
    emFindOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === 'tenant-1' && where.isActive === true) return { id: 'tenant-1' }
      if (where.id === 'creator-1') {
        return { id: 'creator-1', tenantId: 'tenant-2', organizationId: null }
      }
      return null
    })

    await expect(
      getAuthFromRequest(buildRequest('foreign-creator-secret')),
    ).resolves.toBeNull()
  })

  it('accepts a tenant-scoped regular key that records no creator', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue({
      id: 'key-no-creator',
      name: 'no creator',
      tenantId: 'tenant-1',
      organizationId: null,
      rolesJson: [],
      sessionToken: null,
      sessionUserId: null,
      sessionSecretEncrypted: null,
      opencodeSessionId: null,
      createdBy: null,
      expiresAt: null,
      lastUsedAt: null,
    })
    emFindOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === 'tenant-1' && where.isActive === true) return { id: 'tenant-1' }
      return null
    })

    await expect(
      getAuthFromRequest(buildRequest('no-creator-secret')),
    ).resolves.toMatchObject({ keyId: 'key-no-creator', tenantId: 'tenant-1' })
  })

  it('retains the creator identity for an organization-scoped regular key', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue({
      id: 'key-organization-scoped',
      name: 'organization scoped',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      rolesJson: [],
      sessionToken: null,
      sessionUserId: null,
      sessionSecretEncrypted: null,
      opencodeSessionId: null,
      createdBy: 'creator-1',
      expiresAt: null,
      lastUsedAt: null,
    })
    emFindOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === 'creator-1') {
        return { id: 'creator-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      }
      return null
    })

    await expect(
      getAuthFromRequest(buildRequest('organization-scoped-secret')),
    ).resolves.toMatchObject({
      sub: 'api_key:key-organization-scoped',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      userId: 'creator-1',
    })
  })

  it('rejects an organization-scoped regular key when its creator scope no longer matches', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue({
      id: 'key-organization-mismatch',
      name: 'organization mismatch',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      rolesJson: [],
      sessionToken: null,
      sessionUserId: null,
      sessionSecretEncrypted: null,
      opencodeSessionId: null,
      createdBy: 'creator-1',
      expiresAt: null,
      lastUsedAt: null,
    })
    emFindOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === 'creator-1') {
        return { id: 'creator-1', tenantId: 'tenant-1', organizationId: 'org-2' }
      }
      return null
    })

    await expect(
      getAuthFromRequest(buildRequest('organization-scope-mismatch-secret')),
    ).resolves.toBeNull()
  })

  it('keeps session keys strictly bound to their persisted user and scope', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue({
      id: 'key-session-scoped',
      name: 'session scoped',
      tenantId: 'tenant-1',
      organizationId: null,
      rolesJson: [],
      sessionToken: 'sess_123',
      sessionUserId: 'session-user-1',
      sessionSecretEncrypted: null,
      opencodeSessionId: null,
      createdBy: 'session-user-1',
      expiresAt: null,
      lastUsedAt: null,
    })
    emFindOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === 'session-user-1') {
        return { id: 'session-user-1', tenantId: 'tenant-1', organizationId: 'user-org' }
      }
      return null
    })

    await expect(
      getAuthFromRequest(buildRequest('session-scope-mismatch-secret')),
    ).resolves.toBeNull()
  })

  it('fails closed when a row has session markers but no bound session user', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue({
      id: 'key-malformed-session',
      name: 'malformed session',
      tenantId: 'tenant-1',
      organizationId: null,
      rolesJson: [],
      sessionToken: 'sess_missing_user',
      sessionUserId: null,
      sessionSecretEncrypted: null,
      opencodeSessionId: null,
      createdBy: 'creator-1',
      expiresAt: null,
      lastUsedAt: null,
    })

    await expect(
      getAuthFromRequest(buildRequest('malformed-session-secret')),
    ).resolves.toBeNull()
    expect(emFindOne).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'creator-1' }),
    )
  })

  it('caches negative lookups so invalid keys skip the bcrypt+DB path', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue(null)

    const first = await getAuthFromRequest(buildRequest('bad-secret'))
    const second = await getAuthFromRequest(buildRequest('bad-secret'))

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(findApiKeyBySecret).toHaveBeenCalledTimes(1)
  })

  it('invalidates cached entries once the API key is soft-deleted', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { getSharedApiKeyAuthCache } = await import('@open-mercato/shared/lib/auth/apiKeyAuthCache')
    findApiKeyBySecret.mockResolvedValue({
      id: 'key-invalidate',
      name: 'cached',
      tenantId: null,
      organizationId: null,
      rolesJson: [],
      sessionUserId: null,
      createdBy: null,
      expiresAt: null,
      lastUsedAt: null,
    })

    await getAuthFromRequest(buildRequest('secret-invalidate'))
    expect(findApiKeyBySecret).toHaveBeenCalledTimes(1)

    getSharedApiKeyAuthCache().invalidateByKeyId('key-invalidate')
    await getAuthFromRequest(buildRequest('secret-invalidate'))
    expect(findApiKeyBySecret).toHaveBeenCalledTimes(2)
  })

  describe('super-admin bit stays bounded by the effective key scope', () => {
    async function resolveWithSuperAdminRole(input: {
      secret: string
      keyId: string
      keyOrganizationId: string | null
      aclOrganizations: string[] | null
    }) {
      const { RoleAcl } = await import('@open-mercato/core/modules/auth/data/entities')
      const { Organization, Tenant } = await import('@open-mercato/core/modules/directory/data/entities')
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      // A creator-less key is validated against a live tenant (and organization when bound).
      emFindOne.mockImplementation(async (entity: unknown) => {
        if (entity === Tenant) return { id: 'tenant-1' }
        if (entity === Organization) return { id: input.keyOrganizationId, tenant: { id: 'tenant-1' } }
        return null
      })
      findApiKeyBySecret.mockResolvedValue({
        id: input.keyId,
        name: 'super admin key',
        tenantId: 'tenant-1',
        organizationId: input.keyOrganizationId,
        rolesJson: ['role-super'],
        sessionToken: null,
        sessionUserId: null,
        sessionSecretEncrypted: null,
        opencodeSessionId: null,
        createdBy: null,
        expiresAt: null,
        lastUsedAt: null,
      })
      emFind.mockImplementation(async (entity: unknown) => {
        if (entity === RoleAcl) {
          return [{ isSuperAdmin: true, organizationsJson: input.aclOrganizations }]
        }
        return []
      })
      return getAuthFromRequest(buildRequest(input.secret))
    }

    it('withholds it from an organization-bound key even when a role grants it', async () => {
      // Generic guards trust this bit before live RBAC, so an organization-restricted key must
      // never take super-admin shortcuts outside its own scope.
      const auth = await resolveWithSuperAdminRole({
        secret: 'super-bound',
        keyId: 'key-super-bound',
        keyOrganizationId: 'org-1',
        aclOrganizations: null,
      })

      expect(auth).toMatchObject({ isApiKey: true, isSuperAdmin: false })
    })

    it('withholds it when the granting role ACL is itself organization-restricted', async () => {
      const auth = await resolveWithSuperAdminRole({
        secret: 'super-restricted',
        keyId: 'key-super-restricted',
        keyOrganizationId: null,
        aclOrganizations: ['org-1'],
      })

      expect(auth).toMatchObject({ isApiKey: true, isSuperAdmin: false })
    })

    it('grants it for an unbound key with an unrestricted role grant', async () => {
      const auth = await resolveWithSuperAdminRole({
        secret: 'super-global',
        keyId: 'key-super-global',
        keyOrganizationId: null,
        aclOrganizations: null,
      })

      expect(auth).toMatchObject({ isApiKey: true, isSuperAdmin: true })
    })

    it('grants it for an unbound key whose role ACL uses the __all__ sentinel', async () => {
      const auth = await resolveWithSuperAdminRole({
        secret: 'super-all-sentinel',
        keyId: 'key-super-all-sentinel',
        keyOrganizationId: null,
        aclOrganizations: ['__all__'],
      })

      expect(auth).toMatchObject({ isApiKey: true, isSuperAdmin: true })
    })
  })
})
