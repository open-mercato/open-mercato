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
