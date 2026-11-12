// #8268 review Major 2: `customer_users.email` is encrypted at rest
// (`customer_accounts/encryption.ts`'s `customer_accounts:customer_user` map, mirrored
// below rather than imported — this module must never couple to `customer_accounts`'
// own code, only its table shape). A raw SQL read used to return the ciphertext
// unchanged, which `approvalEmails.ts` would send straight to as the recipient address.
// This suite proves the fix against a REAL `TenantDataEncryptionService` encrypt/decrypt
// round trip (AES-GCM, not a mock), not a plaintext stand-in.

import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { listCompanyCustomerUserCandidates, resolveCustomerUserEmail } from '../approvalEmailRecipients'

const CUSTOMER_USER_MAP = {
  entityId: 'customer_accounts:customer_user',
  fields: [{ field: 'email', hashField: 'email_hash' }, { field: 'display_name' }],
}

describe('customer_groups approvalEmailRecipients (real encryption)', () => {
  const dekKey = Buffer.alloc(32, 9).toString('base64')
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeAll(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
  })

  afterAll(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  function createEncryptionService(): TenantDataEncryptionService {
    // A separate, minimal EntityManager stand-in — only used by the service to resolve
    // the (seeded) encryption map policy row; unrelated to the `customer_users` table
    // fake the functions under test query below.
    const policyEm = {
      execute: async (_sql: string, params: unknown[]) =>
        params[0] === CUSTOMER_USER_MAP.entityId
          ? [{ entity_id: CUSTOMER_USER_MAP.entityId, fields_json: CUSTOMER_USER_MAP.fields }]
          : [],
    }
    const kms: KmsService = {
      isHealthy: () => true,
      getTenantDek: async (tenantId) => ({ tenantId, key: dekKey, fetchedAt: Date.now() }),
      createTenantDek: async (tenantId) => ({ tenantId, key: dekKey, fetchedAt: Date.now() }),
    }
    return new TenantDataEncryptionService(policyEm as never, { kms })
  }

  function makeContainer(service: TenantDataEncryptionService | null) {
    return {
      resolve: <T,>(name: string): T => {
        if (name === 'tenantEncryptionService' && service) return service as unknown as T
        throw new Error(`not registered: ${name}`)
      },
    }
  }

  function makeDomainEm(rows: Array<Record<string, unknown>>) {
    const execute = jest.fn(async () => rows)
    return { getConnection: () => ({ execute }) } as unknown as EntityManager
  }

  it('decrypts every candidate email instead of returning ciphertext', async () => {
    const tenantId = randomUUID()
    const service = createEncryptionService()
    const plainEmails = ['decider1@example.com', 'decider2@example.com']
    const encrypted = await Promise.all(
      plainEmails.map((email) => service.encryptEntityPayload(CUSTOMER_USER_MAP.entityId, { email }, tenantId)),
    )
    // Sanity: the stored value really is ciphertext, not the plaintext address.
    for (let i = 0; i < encrypted.length; i += 1) expect(encrypted[i].email).not.toBe(plainEmails[i])

    const em = makeDomainEm(encrypted.map((row, i) => ({ id: `candidate-${i}`, email: row.email })))
    const candidates = await listCompanyCustomerUserCandidates(em, 'company-1', tenantId, makeContainer(service))

    expect(candidates).toEqual([
      { id: 'candidate-0', email: plainEmails[0] },
      { id: 'candidate-1', email: plainEmails[1] },
    ])
  })

  it('decrypts the single resolved requester email instead of returning ciphertext', async () => {
    const tenantId = randomUUID()
    const service = createEncryptionService()
    const plainEmail = 'requester@example.com'
    const encrypted = await service.encryptEntityPayload(CUSTOMER_USER_MAP.entityId, { email: plainEmail }, tenantId)
    expect(encrypted.email).not.toBe(plainEmail)

    const em = makeDomainEm([{ email: encrypted.email }])
    const email = await resolveCustomerUserEmail(em, 'requester-1', tenantId, makeContainer(service))

    expect(email).toBe(plainEmail)
  })

  it('returns the stored value unchanged when the encryption service is unavailable (optional peer absent)', async () => {
    const em = makeDomainEm([{ id: 'candidate-0', email: 'plain@example.com' }])
    const candidates = await listCompanyCustomerUserCandidates(em, 'company-1', 'tenant-1', makeContainer(null))
    expect(candidates).toEqual([{ id: 'candidate-0', email: 'plain@example.com' }])
  })

  it('returns the stored value unchanged for a tenant with encryption disabled (plaintext row, real service)', async () => {
    const tenantId = randomUUID()
    const service = createEncryptionService()
    const original = process.env.TENANT_DATA_ENCRYPTION
    delete process.env.TENANT_DATA_ENCRYPTION
    try {
      const em = makeDomainEm([{ email: 'plain@example.com' }])
      const email = await resolveCustomerUserEmail(em, 'requester-1', tenantId, makeContainer(service))
      expect(email).toBe('plain@example.com')
    } finally {
      if (original === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = original
    }
  })
})
