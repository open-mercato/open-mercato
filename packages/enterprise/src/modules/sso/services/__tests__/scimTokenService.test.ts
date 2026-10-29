import { createCacheService, runWithCacheTenant } from '@open-mercato/cache'
import { compare } from 'bcryptjs'
import { readScimAdmissionKey, SCIM_ADMISSION_TTL_MS, scimTokenLookupHash } from '../../lib/scim-admission-cache'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ScimToken, SsoConfig } from '../../data/entities'
import type { SsoAdminScope } from '../ssoConfigService'
import { ScimTokenError, ScimTokenService } from '../scimTokenService'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-token'),
  compare: jest.fn().mockResolvedValue(false),
}))

async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (err) {
    return err
  }
  throw new Error('Expected the call to throw, but it resolved')
}

function createEntityManagerMock() {
  const flush = jest.fn().mockResolvedValue(undefined)
  return {
    flush,
    em: {
      findOne: jest.fn(),
      create: jest.fn().mockReturnValue({
        id: 'scim-token-1',
        tokenPrefix: 'omscim_12345',
      }),
      persist: jest.fn().mockReturnValue({ flush }),
    },
  }
}

describe('ScimTokenService.generateToken', () => {
  const sameOrgScope: SsoAdminScope = {
    isSuperAdmin: false,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
  }

  it('scopes non-superadmin config lookup to the caller organization', async () => {
    const { em, flush } = createEntityManagerMock()
    em.findOne.mockResolvedValue({
      id: 'sso-config-1',
      jitEnabled: false,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
    const service = new ScimTokenService(em as unknown as EntityManager)

    const generated = await service.generateToken('sso-config-1', 'Directory sync', sameOrgScope)
    expect(em.create).toHaveBeenCalledWith(ScimToken, expect.objectContaining({ tokenLookupHash: scimTokenLookupHash(generated.token) }))

    expect(em.findOne).toHaveBeenCalledWith(SsoConfig, {
      id: 'sso-config-1',
      deletedAt: null,
      organizationId: 'org-1',
    })
    expect(em.create).toHaveBeenCalledWith(ScimToken, expect.objectContaining({
      ssoConfigId: 'sso-config-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      tokenLookupHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('fails closed before lookup when a non-superadmin has no organization scope', async () => {
    const { em } = createEntityManagerMock()
    em.findOne.mockResolvedValue({ id: 'foreign-config', jitEnabled: false })
    const service = new ScimTokenService(em as unknown as EntityManager)

    const thrown = await captureThrow(() => service.generateToken('foreign-config', 'Foreign token', {
      isSuperAdmin: false,
      organizationId: null,
      tenantId: 'tenant-1',
    }))

    expect(thrown).toBeInstanceOf(ScimTokenError)
    expect((thrown as ScimTokenError).statusCode).toBe(403)
    expect((thrown as ScimTokenError).message).toBe('Organization context is required')
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })
})

describe('verified SCIM admission cache', () => {
  const rawToken = `omscim_${'a'.repeat(64)}`
  const scope: SsoAdminScope = { isSuperAdmin: false, organizationId: 'org-1', tenantId: 'tenant-1' }
  const originalEnabled = process.env.RATE_LIMIT_ENABLED
  const originalIntegration = process.env.OM_INTEGRATION_TEST

  beforeEach(() => {
    jest.useFakeTimers()
    delete process.env.RATE_LIMIT_ENABLED
    delete process.env.OM_INTEGRATION_TEST
    jest.mocked(compare).mockReset()
    mockReportError.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
    if (originalEnabled === undefined) delete process.env.RATE_LIMIT_ENABLED
    else process.env.RATE_LIMIT_ENABLED = originalEnabled
    if (originalIntegration === undefined) delete process.env.OM_INTEGRATION_TEST
    else process.env.OM_INTEGRATION_TEST = originalIntegration
  })

  function setup() {
    const token = { id: 'token-1', ssoConfigId: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1', tokenHash: 'stored-hash', isActive: true }
    const em = {
      find: jest.fn(async () => token.isActive ? [token] : []),
      findOne: jest.fn(async () => token),
      flush: jest.fn(async () => undefined),
      nativeUpdate: jest.fn(async () => 1),
    }
    const cache = createCacheService({ strategy: 'memory' })
    const service = new ScimTokenService(em as unknown as EntityManager, cache)
    jest.mocked(compare).mockImplementation(async (raw) => raw === rawToken)
    return { token, em, cache, service }
  }

  it('records only fully verified bearers, shares entries across request scopes, and expires them', async () => {
    const { em, cache, service } = setup()
    expect(await readScimAdmissionKey(cache, rawToken)).toBeNull()
    expect(await service.verifyToken(`${rawToken.slice(0, 12)}${'b'.repeat(59)}`)).toBeNull()
    expect(await readScimAdmissionKey(cache, rawToken)).toBeNull()
    await runWithCacheTenant('tenant-1', () => service.verifyToken(rawToken))
    expect(await readScimAdmissionKey(cache, rawToken)).toBe('token:tenant-1:org-1:token-1')
    const nextRequest = new ScimTokenService(em as unknown as EntityManager, cache)
    await nextRequest.verifyToken(rawToken)
    expect(em.find).toHaveBeenCalledTimes(3)
    expect(jest.mocked(compare)).toHaveBeenCalledTimes(3)
    const keys = await runWithCacheTenant(null, () => cache.keys())
    expect(keys).toHaveLength(1)
    expect(keys[0]).not.toContain('omscim_')
    jest.advanceTimersByTime(SCIM_ADMISSION_TTL_MS + 1)
    expect(await readScimAdmissionKey(cache, rawToken)).toBeNull()
  })

  it('backfills legacy credentials only after bcrypt and guards scope, active state and the compared hash', async () => {
    const { token, em, service } = setup()
    const wrongSuffix = `${rawToken.slice(0, 12)}${'b'.repeat(59)}`
    expect(await service.verifyToken(wrongSuffix)).toBeNull()
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(await service.verifyToken(rawToken)).toEqual(expect.objectContaining({ organizationId: 'org-1', tenantId: 'tenant-1' }))
    const tokenLookupHash = scimTokenLookupHash(rawToken)
    expect(em.nativeUpdate).toHaveBeenCalledWith(ScimToken, {
      id: token.id, tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: 'config-1',
      tokenHash: 'stored-hash', isActive: true, $or: [{ tokenLookupHash: null }, { tokenLookupHash }],
    }, { tokenLookupHash })
  })

  it('rejects enrollment when the database compare-and-set loses a concurrent change', async () => {
    const { em, cache, service } = setup()
    em.nativeUpdate.mockResolvedValue(0)
    expect(await service.verifyToken(rawToken)).toBeNull()
    expect(await readScimAdmissionKey(cache, rawToken)).toBeNull()
  })

  it('does not emit fingerprint or verifier query material when enrollment fails', async () => {
    const { em, cache, service } = setup()
    const fingerprint = scimTokenLookupHash(rawToken)
    em.nativeUpdate.mockRejectedValue(new Error(`query failed: ${fingerprint} stored-hash`))
    await expect(service.verifyToken(rawToken)).rejects.toThrow('[internal] SCIM token enrollment unavailable')
    const reported = mockReportError.mock.calls.map(([error]) => String(error)).join(' ')
    expect(reported).not.toContain(fingerprint)
    expect(reported).not.toContain('stored-hash')
    expect(mockReportError).toHaveBeenCalledWith(expect.objectContaining({ message: '[internal] SCIM token enrollment unavailable' }), { module: 'sso', code: 'sso.scim_enrollment_unavailable' })
    expect(await readScimAdmissionKey(cache, rawToken)).toBeNull()
  })

  it('uses the bcrypt hash captured before comparison in the enrollment guard', async () => {
    const { token, em, service } = setup()
    jest.mocked(compare).mockImplementationOnce(async () => {
      token.tokenHash = 'changed-hash'
      return true
    })
    em.nativeUpdate.mockResolvedValue(0)
    expect(await service.verifyToken(rawToken)).toBeNull()
    expect(em.nativeUpdate).toHaveBeenCalledWith(ScimToken, expect.objectContaining({ tokenHash: 'stored-hash' }), expect.any(Object))
  })

  it('retains null-tenant legacy scope and permits an identical concurrent enrollment', async () => {
    const { token, em, service } = setup()
    Object.assign(token, { tenantId: null })
    await service.verifyToken(rawToken)
    expect(em.nativeUpdate).toHaveBeenCalledWith(ScimToken, expect.objectContaining({ tenantId: null, $or: [{ tokenLookupHash: null }, { tokenLookupHash: scimTokenLookupHash(rawToken) }] }), expect.any(Object))
  })

  it('keeps lookup hashes out of management payloads', async () => {
    const { token, em, service } = setup()
    Object.assign(token, { tokenLookupHash: scimTokenLookupHash(rawToken) })
    const listed = await service.listTokens('config-1', scope)
    expect(listed[0]).not.toHaveProperty('tokenLookupHash')
    expect(listed[0]).not.toHaveProperty('tokenHash')
    expect(listed[0]).not.toHaveProperty('token')
    await service.verifyToken(rawToken)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('invalidates pre-auth entries on scoped revocation and continues to verify active state', async () => {
    const { cache, service } = setup()
    await service.verifyToken(rawToken)
    await runWithCacheTenant('tenant-1', () => service.revokeToken('token-1', scope))
    expect(await readScimAdmissionKey(cache, rawToken)).toBeNull()
    expect(await service.verifyToken(rawToken)).toBeNull()
  })

  it('keeps wrong-organization revocation from invalidating another scope', async () => {
    const { token, em, cache, service } = setup()
    em.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => where.organizationId === token.organizationId ? token : null)
    const invalidate = jest.spyOn(cache, 'deleteByTags')
    await expect(service.revokeToken('token-1', { ...scope, organizationId: 'org-2' })).rejects.toMatchObject({ statusCode: 404 })
    expect(token.isActive).toBe(true)
    expect(em.flush).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps committed revocation successful when cache invalidation fails (telemetry throws: %s)', async (telemetryThrows) => {
    const { token, em, cache, service } = setup()
    await service.verifyToken(rawToken)
    const cacheError = new Error('[internal] Admission cache unavailable')
    jest.spyOn(cache, 'deleteByTags').mockRejectedValue(cacheError)
    if (telemetryThrows) mockReportError.mockImplementation(() => { throw new Error('[internal] Telemetry unavailable') })

    await expect(runWithCacheTenant('tenant-1', () => service.revokeToken('token-1', scope))).resolves.toBeUndefined()

    expect(token.isActive).toBe(false)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.findOne).toHaveBeenCalledWith(ScimToken, { id: 'token-1', organizationId: 'org-1' })
    expect(mockReportError).toHaveBeenCalledWith(cacheError, { module: 'sso', code: 'sso.scim_admission_cache_invalidation_failed' })
    expect(await readScimAdmissionKey(cache, rawToken)).toBe('token:tenant-1:org-1:token-1')
    expect(await service.verifyToken(rawToken)).toBeNull()
  })

  it.each(['RATE_LIMIT_ENABLED', 'OM_INTEGRATION_TEST'])('does not write admission entries when %s disables enforcement', async (flag) => {
    const { cache, service } = setup()
    process.env[flag] = flag === 'RATE_LIMIT_ENABLED' ? 'false' : 'true'
    await service.verifyToken(rawToken)
    expect(await readScimAdmissionKey(cache, rawToken)).toBeNull()
  })
})
