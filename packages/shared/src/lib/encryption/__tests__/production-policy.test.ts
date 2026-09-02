import {
  TenantDataEncryptionService,
  TenantDataEncryptionUnavailableError,
} from '../tenantDataEncryptionService'
import {
  assertTenantDataEncryptionConfiguration,
  isTenantDataEncryptionRequired,
  TenantDataEncryptionConfigurationError,
} from '../toggles'

const originalEnv = { ...process.env }
const entityId = 'test:protected_record'

function makeService(options: { healthy: boolean; dek?: string | null }) {
  return new TenantDataEncryptionService(
    { getConnection: () => ({ execute: jest.fn(async () => []) }) } as never,
    {
      kms: {
        isHealthy: () => options.healthy,
        getTenantDek: jest.fn(async () => options.dek
          ? { tenantId: `system:${entityId}`, key: options.dek, fetchedAt: Date.now() }
          : null),
        createTenantDek: jest.fn(async () => null),
      },
      defaultEncryptionMaps: [{
        entityId,
        keyScope: 'system',
        fields: [{ field: 'secret' }],
      }],
    },
  )
}

describe('production tenant encryption policy', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'production', TENANT_DATA_ENCRYPTION: 'true' }
  })

  afterAll(() => {
    process.env = { ...originalEnv }
  })

  it('requires tenant encryption in production', () => {
    expect(isTenantDataEncryptionRequired()).toBe(true)
  })

  it('does not allow production to opt out of required encryption', () => {
    process.env.TENANT_DATA_ENCRYPTION_REQUIRED = 'false'

    expect(isTenantDataEncryptionRequired()).toBe(true)
  })

  it('rejects production startup when encryption is disabled', () => {
    process.env.TENANT_DATA_ENCRYPTION = 'false'

    expect(() => assertTenantDataEncryptionConfiguration(true))
      .toThrow(TenantDataEncryptionConfigurationError)
  })

  it('rejects production startup when no healthy KMS is available', () => {
    expect(() => assertTenantDataEncryptionConfiguration(false))
      .toThrow(TenantDataEncryptionConfigurationError)
  })

  it('rejects a protected write when the KMS is unhealthy', async () => {
    const service = makeService({ healthy: false })

    await expect(service.encryptEntityPayload(entityId, { secret: 'plaintext' }, null, null))
      .rejects.toEqual(expect.objectContaining({
        name: 'TenantDataEncryptionUnavailableError',
        entityId,
      }))
  })

  it('rejects a protected write when a DEK cannot be resolved or created', async () => {
    const service = makeService({ healthy: true, dek: null })

    await expect(service.encryptEntityPayload(entityId, { secret: 'plaintext' }, null, null))
      .rejects.toBeInstanceOf(TenantDataEncryptionUnavailableError)
  })

  it('does not block an entity payload that contains no mapped value', async () => {
    const service = makeService({ healthy: false })

    await expect(service.encryptEntityPayload(entityId, { publicValue: 'safe' }, null, null))
      .resolves.toEqual({ publicValue: 'safe' })
  })

  it('keeps the explicit non-production opt-in available', () => {
    process.env.NODE_ENV = 'development'
    process.env.TENANT_DATA_ENCRYPTION_REQUIRED = 'true'

    expect(isTenantDataEncryptionRequired()).toBe(true)
  })

  it('keeps disabled non-production writes as no-op without loading a map', async () => {
    process.env.NODE_ENV = 'development'
    process.env.TENANT_DATA_ENCRYPTION = 'false'
    process.env.TENANT_DATA_ENCRYPTION_REQUIRED = 'false'
    const execute = jest.fn(async () => [])
    const service = new TenantDataEncryptionService(
      { getConnection: () => ({ execute }) } as never,
      { kms: { isHealthy: () => false, getTenantDek: jest.fn(async () => null) } },
    )

    await expect(service.encryptEntityPayload(entityId, { secret: 'plaintext' }, null, null))
      .resolves.toEqual({ secret: 'plaintext' })
    expect(execute).not.toHaveBeenCalled()
  })
})
