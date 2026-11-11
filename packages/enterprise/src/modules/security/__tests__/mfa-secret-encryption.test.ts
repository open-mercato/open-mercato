import { randomBytes } from 'node:crypto'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { hashForLookup, isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { defaultEncryptionMaps } from '../encryption'
import { Migration20261107120000_mfa_secret_encryption } from '../migrations/Migration20261107120000_mfa_secret_encryption'

const tenantId = 'mfa-encryption-test-tenant'
const organizationId = 'mfa-encryption-test-org'

function createEncryptionService() {
  const map = defaultEncryptionMaps.find((entry) => entry.entityId === 'security:user_mfa_method')!
  const execute = jest.fn(async (_sql: string, params: unknown[]) => params[1] === tenantId ? [{
    entity_id: map.entityId,
    tenant_id: tenantId,
    organization_id: organizationId,
    fields_json: map.fields,
  }] : [])
  const key = randomBytes(32).toString('base64')
  return new TenantDataEncryptionService({ execute } as never, {
    kms: {
      isHealthy: () => true,
      getTenantDek: async () => ({ tenantId, key, fetchedAt: Date.now() }),
      createTenantDek: async () => null,
    } as never,
  })
}

describe('MFA method encryption', () => {
  const originalEncryption = process.env.TENANT_DATA_ENCRYPTION
  beforeEach(() => { process.env.TENANT_DATA_ENCRYPTION = 'yes' })
  afterEach(() => {
    if (originalEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalEncryption
  })

  test('encrypts current and legacy seed locations and preserves setup lookup', async () => {
    const service = createEncryptionService()
    const plaintext = { secret: 'synthetic-seed', providerMetadata: { secret: 'legacy-synthetic-seed', label: 'Phone' } }
    const encrypted = await service.encryptEntityPayload('security:user_mfa_method', plaintext, tenantId, organizationId)
    expect(isEncryptedPayloadShape(encrypted.secret)).toBe(true)
    expect(isEncryptedPayloadShape(encrypted.providerMetadata)).toBe(true)
    expect(encrypted.secret_hash).toBe(hashForLookup(plaintext.secret))
    expect(JSON.stringify(encrypted)).not.toContain('synthetic-seed')
    const decrypted = await service.decryptEntityPayload('security:user_mfa_method', encrypted, tenantId, organizationId)
    expect(decrypted.secret).toBe(plaintext.secret)
    expect(JSON.parse(String(decrypted.providerMetadata))).toEqual(plaintext.providerMetadata)
    const repeated = await service.encryptEntityPayload('security:user_mfa_method', encrypted, tenantId, organizationId)
    expect(repeated).toEqual(encrypted)
  })

  test('keeps plaintext reads compatible during the required historical backfill', async () => {
    const service = createEncryptionService()
    const plaintext = { secret: 'synthetic-existing-seed', providerMetadata: { secret: 'synthetic-existing-legacy-seed' } }
    await expect(service.decryptEntityPayload('security:user_mfa_method', plaintext, tenantId, organizationId)).resolves.toEqual(plaintext)
    const backfilled = await service.encryptEntityPayload('security:user_mfa_method', plaintext, tenantId, organizationId)
    expect(isEncryptedPayloadShape(backfilled.secret)).toBe(true)
    expect(isEncryptedPayloadShape(backfilled.providerMetadata)).toBe(true)
  })

  test('migration adds the hash before registering both fields for existing scopes', () => {
    const statements: string[] = []
    const migration = new Migration20261107120000_mfa_secret_encryption({} as never, {} as never)
    jest.spyOn(migration, 'addSql').mockImplementation((sql) => { statements.push(String(sql)) })
    migration.up()
    expect(statements[0]).toContain('add column "secret_hash"')
    expect(statements[1]).toContain('security:user_mfa_method')
    expect(statements[1]).toContain('provider_metadata')
    expect(statements[1]).toContain('"hashField":"secret_hash"')
    expect(statements[1]).toContain("to_regclass('encryption_maps')")
  })
})
