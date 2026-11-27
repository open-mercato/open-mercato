import type { EntityManager } from '@mikro-orm/postgresql'
import polish from '../../i18n/pl.json'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { getTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { SsoConfig } from '../../data/entities'
import { emitSsoEvent } from '../../events'
import type { SsoProviderRegistry } from '../../lib/registry'
import { SsoConfigService, type SsoAdminScope } from '../ssoConfigService'
import type { SsoAuthorizationService } from '../ssoAuthorizationService'

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: jest.fn() }))

jest.mock('../../events', () => ({ emitSsoEvent: jest.fn().mockResolvedValue(undefined) }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: keyof typeof polish, fallback: string) => polish[key] ?? fallback,
  }),
}))

const scope: SsoAdminScope = {
  actorUserId: 'config-editor', isSuperAdmin: false, tenantId: 'tenant-1', organizationId: 'org-1',
}

function fixture(existing = true) {
  const config = Object.assign(new SsoConfig(), {
    id: 'config-1', tenantId: 'tenant-1', organizationId: 'org-1', protocol: 'oidc',
    allowedDomains: ['example.com'], appRoleMappings: { staff: 'employee' }, authorizationUserId: 'previous-editor',
  })
  const em = {
    findOne: jest.fn().mockResolvedValue(existing ? config : null),
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => Object.assign(config, values)),
    persist: jest.fn(), flush: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
    getConnection: jest.fn().mockReturnValue({ execute: jest.fn().mockResolvedValue([]) }),
    transactional: jest.fn(),
  }
  em.persist.mockReturnValue(em)
  em.transactional.mockImplementation(async (callback: (transaction: EntityManager) => Promise<unknown>) => callback(em as unknown as EntityManager))
  const authorization = { assertConfiguration: jest.fn().mockResolvedValue('tenant-1') }
  const encryption = { encryptEntityPayload: jest.fn().mockResolvedValue({ clientSecretEnc: 'encrypted' }) }
  const service = new SsoConfigService(
    em as unknown as EntityManager,
    encryption as unknown as TenantDataEncryptionService,
    { resolve: jest.fn().mockReturnValue({ validateConfig: jest.fn().mockResolvedValue({ ok: true }) }) } as unknown as SsoProviderRegistry,
    authorization as unknown as SsoAuthorizationService,
  )
  return { config, em, authorization, encryption, service }
}

const createInput = {
  protocol: 'oidc' as const, issuer: 'https://idp.example.com', clientId: 'client', clientSecret: 'secret',
  allowedDomains: ['example.com'], jitEnabled: true, autoLinkByEmail: true,
  appRoleMappings: { elevated: 'superadmin' },
}

describe('SSO configuration authority', () => {
  beforeEach(() => {
    jest.mocked(emitSsoEvent).mockClear()
    jest.mocked(getTelemetryRuntime).mockReset()
  })

  it('localizes the duplicate configuration conflict', async () => {
    const { service } = fixture()
    await expect(service.create(scope, createInput)).rejects.toMatchObject({
      statusCode: 409,
      message: polish['sso.admin.error.alreadyExists'],
    })
  })

  it('localizes the missing configuration error for a write', async () => {
    const { service } = fixture(false)
    await expect(service.delete(scope, 'config-1')).rejects.toMatchObject({
      statusCode: 404,
      message: polish['sso.admin.error.notFound'],
    })
  })

  it('keeps committed writes successful when event and telemetry reporting fail', async () => {
    const { service } = fixture(false)
    const reportError = jest.fn(() => { throw new Error('[internal] Telemetry unavailable') })
    jest.mocked(getTelemetryRuntime).mockReturnValue({ reportError } as unknown as TelemetryRuntime)
    jest.mocked(emitSsoEvent).mockRejectedValueOnce(new Error('[internal] Event unavailable'))
    await expect(service.create(scope, createInput)).resolves.toHaveProperty('id', 'config-1')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('does not publish a config event when the transaction fails to commit', async () => {
    const { service, em } = fixture(false)
    em.transactional.mockImplementationOnce(async (callback: (transaction: EntityManager) => Promise<unknown>) => {
      await callback(em as unknown as EntityManager)
      throw new Error('[internal] Commit rejected')
    })
    await expect(service.create(scope, createInput)).rejects.toThrow('Commit rejected')
    expect(emitSsoEvent).not.toHaveBeenCalled()
  })
  it('rejects a denied role mapping on create before persisting credentials or config', async () => {
    const { service, authorization, encryption, em } = fixture(false)
    authorization.assertConfiguration.mockRejectedValue(forbidden('denied'))
    await expect(service.create(scope, createInput)).rejects.toMatchObject({ status: 403 })
    expect(encryption.encryptEntityPayload).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('records the server actor after an authorized create', async () => {
    const { service, authorization, em } = fixture(false)
    await service.create(scope, createInput)
    expect(authorization.assertConfiguration).toHaveBeenCalledWith(em, expect.objectContaining({
      tenantId: scope.tenantId, organizationId: scope.organizationId, appRoleMappings: createInput.appRoleMappings,
    }), scope.actorUserId)
    expect(em.create).toHaveBeenCalledWith(SsoConfig, expect.objectContaining({ authorizationUserId: scope.actorUserId }))
    expect(emitSsoEvent).toHaveBeenCalledWith('sso.config.created', expect.objectContaining({ id: 'config-1' }))
  })

  it('rejects denied mappings on update without changing the managed config', async () => {
    const { service, authorization, config, em } = fixture()
    authorization.assertConfiguration.mockRejectedValue(forbidden('denied'))
    await expect(service.update(scope, config.id, { appRoleMappings: { elevated: 'superadmin' } })).rejects.toMatchObject({ status: 403 })
    expect(config.appRoleMappings).toEqual({ staff: 'employee' })
    expect(config.authorizationUserId).toBe('previous-editor')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('checks retained mappings when only the issuer changes', async () => {
    const { service, authorization, config, em } = fixture()
    authorization.assertConfiguration.mockRejectedValue(forbidden('denied'))
    await expect(service.update(scope, config.id, { issuer: 'https://attacker.example.com' })).rejects.toMatchObject({ status: 403 })
    expect(authorization.assertConfiguration).toHaveBeenCalledWith(em, expect.objectContaining({ appRoleMappings: config.appRoleMappings }), scope.actorUserId)
    expect(config.issuer).toBeUndefined()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('reauthorizes a legacy configuration on an authorized save', async () => {
    const { service, config, em } = fixture()
    config.authorizationUserId = null
    await service.update(scope, config.id, { name: 'Reauthorized' })
    expect(config.authorizationUserId).toBe(scope.actorUserId)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it.each(['activate', 'addDomain', 'removeDomain'] as const)('checks authority for %s', async (operation) => {
    const { service, authorization, config, em } = fixture()
    authorization.assertConfiguration.mockRejectedValue(forbidden('denied'))
    const result = operation === 'activate' ? service.activate(scope, config.id, true)
      : service[operation](scope, config.id, 'other.example.com')
    await expect(result).rejects.toMatchObject({ status: 403 })
    expect(config.isActive).toBe(false)
    expect(config.allowedDomains).toEqual(['example.com'])
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('allows deactivating an unsafe config without reauthorizing it', async () => {
    const { service, authorization, config } = fixture()
    config.isActive = true
    await service.activate(scope, config.id, false)
    expect(config.isActive).toBe(false)
    expect(authorization.assertConfiguration).not.toHaveBeenCalled()
  })
})
