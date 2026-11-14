import type { EntityManager } from '@mikro-orm/postgresql'
import {
  TenantDataEncryptionUnavailableError,
  type TenantDataEncryptionService,
} from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { SSO_CONFIG_ENCRYPTION_ENTITY_ID } from '../../encryption'
import type { SsoProviderRegistry } from '../../lib/registry'
import { SsoConfigService } from '../ssoConfigService'

function buildService() {
  const em = {
    findOne: jest.fn(),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
      id: 'config-1',
      createdAt: new Date('2026-08-21T00:00:00.000Z'),
      updatedAt: new Date('2026-08-21T00:00:00.000Z'),
      deletedAt: null,
      ...data,
    })),
    persist: jest.fn(() => ({ flush: jest.fn().mockResolvedValue(undefined) })),
  }
  const encryptionService = {
    encryptEntityPayload: jest.fn(async (_entityId: string, payload: Record<string, unknown>) => ({
      ...payload,
      clientSecretEnc: 'encrypted-client-secret',
    })),
  }
  const registry = { resolve: jest.fn() }
  const service = new SsoConfigService(
    em as unknown as EntityManager,
    encryptionService as unknown as TenantDataEncryptionService,
    registry as unknown as SsoProviderRegistry,
  )
  return { service, em, encryptionService }
}

describe('SsoConfigService login policy', () => {
  test('persists SSO-only and OIDC assurance settings on create', async () => {
    const { service, em, encryptionService } = buildService()
    em.findOne.mockResolvedValue(null)

    const result = await service.create(
      { isSuperAdmin: false, tenantId: 'tenant-1', organizationId: 'organization-1' },
      {
        name: 'Company OIDC',
        protocol: 'oidc',
        issuer: 'https://idp.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        allowedDomains: ['example.com'],
        jitEnabled: true,
        autoLinkByEmail: true,
        ssoRequired: true,
        requiredAcrValues: ['urn:example:loa:2'],
        requiredAmrValues: ['pwd', 'otp'],
        appRoleMappings: {},
      },
    )

    expect(encryptionService.encryptEntityPayload).toHaveBeenCalledWith(
      SSO_CONFIG_ENCRYPTION_ENTITY_ID,
      { clientSecretEnc: 'client-secret' },
      'tenant-1',
      'organization-1',
    )
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ssoRequired: true,
        requiredAcrValues: ['urn:example:loa:2'],
        requiredAmrValues: ['pwd', 'otp'],
      }),
    )
    expect(result).toMatchObject({
      ssoRequired: true,
      requiredAcrValues: ['urn:example:loa:2'],
      requiredAmrValues: ['pwd', 'otp'],
      hasClientSecret: true,
    })
  })

  test('scopes SSO-required lookup by tenant and organization', async () => {
    const { service, em } = buildService()
    em.findOne.mockResolvedValue({ id: 'config-1' })

    await expect(service.isSsoRequiredForOrganization('tenant-1', 'organization-1')).resolves.toBe(true)
    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        tenantId: 'tenant-1',
        organizationId: 'organization-1',
        isActive: true,
        ssoRequired: true,
        deletedAt: null,
      },
    )
  })

  test('reports required client-secret encryption outages as unavailable', async () => {
    const { service, em, encryptionService } = buildService()
    em.findOne.mockResolvedValue(null)
    encryptionService.encryptEntityPayload.mockRejectedValueOnce(
      new TenantDataEncryptionUnavailableError(SSO_CONFIG_ENCRYPTION_ENTITY_ID, 'kms-unhealthy'),
    )

    await expect(service.create(
      { isSuperAdmin: false, tenantId: 'tenant-1', organizationId: 'organization-1' },
      {
        name: 'Company OIDC',
        protocol: 'oidc',
        issuer: 'https://idp.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        allowedDomains: ['example.com'],
        jitEnabled: true,
        autoLinkByEmail: true,
        ssoRequired: true,
        requiredAcrValues: [],
        requiredAmrValues: [],
        appRoleMappings: {},
      },
    )).rejects.toMatchObject({ name: 'SsoConfigError', statusCode: 503 })
  })
})
