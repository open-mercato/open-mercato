import { createCacheService, runWithCacheTenant } from '@open-mercato/cache'
import { compare } from 'bcryptjs'
import { readScimAdmissionKey, SCIM_ADMISSION_TTL_MS } from '../../lib/scim-admission-cache'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ScimToken, SsoConfig } from '../../data/entities'
import type { SsoAdminScope } from '../ssoConfigService'
import { ScimTokenError, ScimTokenService } from '../scimTokenService'

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

    await service.generateToken('sso-config-1', 'Directory sync', sameOrgScope)

    expect(em.findOne).toHaveBeenCalledWith(SsoConfig, {
      id: 'sso-config-1',
      deletedAt: null,
      organizationId: 'org-1',
    })
    expect(em.create).toHaveBeenCalledWith(ScimToken, expect.objectContaining({
      ssoConfigId: 'sso-config-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
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

  it('invalidates pre-auth entries on scoped revocation and continues to verify active state', async () => {
    const { cache, service } = setup()
    await service.verifyToken(rawToken)
    await runWithCacheTenant('tenant-1', () => service.revokeToken('token-1', scope))
    expect(await readScimAdmissionKey(cache, rawToken)).toBeNull()
    expect(await service.verifyToken(rawToken)).toBeNull()
  })

  it.each(['RATE_LIMIT_ENABLED', 'OM_INTEGRATION_TEST'])('does not write admission entries when %s disables enforcement', async (flag) => {
    const { cache, service } = setup()
    process.env[flag] = flag === 'RATE_LIMIT_ENABLED' ? 'false' : 'true'
    await service.verifyToken(rawToken)
    expect(await readScimAdmissionKey(cache, rawToken)).toBeNull()
  })
})
