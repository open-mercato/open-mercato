/**
 * MCP and the AI chat authenticate by session token, and that only works if the ephemeral key's
 * secret can be handed back later — `session_secret_encrypted` exists for no other reason.
 *
 * It used to be written only when a DEK was reachable, which is never true under
 * `TENANT_DATA_ENCRYPTION=no`. The column stayed null, `findSessionApiKeyWithSecret` returned null,
 * and the only trace was a debug-level log: MCP session auth was simply off for anyone who had
 * disabled encryption, with nothing to point at.
 */

const mockCreateKmsService = jest.fn()

// `resolveEncryptionMode` stays real — it is the disabled/unavailable split under test.
jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/kms'),
  createKmsService: (...args: unknown[]) => mockCreateKmsService(...args),
}))

import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { ApiKey } from '../data/entities'
import * as aes from '@open-mercato/shared/lib/encryption/aes'
import { generateDek, looksLikeEncryptedPayload } from '@open-mercato/shared/lib/encryption/aes'
import { createApiKey, createSessionApiKey, findSessionApiKeyWithSecret } from '../services/apiKeyService'

const mockDecryptWithAesGcm = jest.spyOn(aes, 'decryptWithAesGcm')
const TENANT = 'tenant-1'
const previousToggle = process.env.TENANT_DATA_ENCRYPTION

function mockKms(dek: string | null) {
  mockCreateKmsService.mockReturnValue({
    isHealthy: () => Boolean(dek),
    getTenantDek: jest.fn(async (tenantId: string) => (dek ? { tenantId, key: dek, fetchedAt: Date.now() } : null)),
    createTenantDek: jest.fn(async (tenantId: string) => (dek ? { tenantId, key: dek, fetchedAt: Date.now() } : null)),
  })
}

function buildEm() {
  const created: Array<Record<string, unknown>> = []
  const owner = { id: 'user-alice', tenantId: TENANT, organizationId: 'org-1', isConfirmed: true, deletedAt: null }
  const tenant = { id: TENANT, isActive: true, deletedAt: null }
  const flush = jest.fn().mockResolvedValue(undefined)
  let inTransaction = false
  const em = {
    create: jest.fn((_Entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `key-${created.length + 1}`, deletedAt: null, ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn(() => ({ flush })),
    flush,
    find: jest.fn(async () => []),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      const record: Record<string, unknown> | null = entity === User ? owner : entity === Tenant ? tenant : entity === ApiKey ? created[0] ?? null : null
      if (!record) return null
      return Object.entries(where).every(([field, value]) => record[field] === value) ? record : null
    }),
    isInTransaction: () => inTransaction,
    begin: jest.fn(async () => { inTransaction = true }),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
  }
  return { em, created, owner, tenant }
}

/** Round-trip a freshly minted session key through storage and back out again. */
async function roundTrip(): Promise<{ stored: unknown; recovered: string | null }> {
  const { em, created } = buildEm()
  await createSessionApiKey(em as never, {
    sessionToken: 'sess_alice',
    userId: 'user-alice',
    userRoles: ['admin'],
    tenantId: TENANT,
    organizationId: 'org-1',
  })
  const row = created[0]
  const result = await findSessionApiKeyWithSecret(em as never, 'sess_alice')
  return { stored: row.sessionSecretEncrypted, recovered: result?.secret ?? null }
}

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  if (previousToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
  else process.env.TENANT_DATA_ENCRYPTION = previousToggle
})

describe('session secret storage', () => {
  it.each(['user-alice', null])('persists an explicit delegated owner without binding ordinary machine keys (%s)', async (ownerId) => {
    const { em, created } = buildEm()
    await createApiKey(em as never, {
      name: 'MCP key', tenantId: TENANT, roles: ['role-a'],
      createdBy: 'user-alice', ...(ownerId ? { sessionUserId: ownerId } : {}),
    })
    expect(created[0].sessionUserId).toBe(ownerId)
  })

  it('seals the secret when encryption is active', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    mockKms(generateDek())

    const { stored, recovered } = await roundTrip()

    expect(looksLikeEncryptedPayload(stored)).toBe(true)
    expect(recovered).toEqual(expect.any(String))
    expect(recovered).not.toEqual(stored)
  })

  it('round-trips the secret in the clear when the operator disabled encryption', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    mockKms(null)

    const { stored, recovered } = await roundTrip()

    expect(stored).toEqual(expect.any(String))
    expect(looksLikeEncryptedPayload(stored)).toBe(false)
    expect(recovered).toBe(stored)
  })

  it('still refuses to store a secret in the clear when the KMS is merely unreachable', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    mockKms(null)

    const { stored, recovered } = await roundTrip()

    // A Vault outage must not silently downgrade a secret nobody asked to store in plaintext.
    expect(stored).toBeNull()
    expect(recovered).toBeNull()
  })

  it('gives up honestly on a secret sealed before the toggle was flipped off', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    mockKms(generateDek())
    const { em, created } = buildEm()
    await createSessionApiKey(em as never, {
      sessionToken: 'sess_alice',
      userId: 'user-alice',
      userRoles: ['admin'],
      tenantId: TENANT,
      organizationId: 'org-1',
    })
    const sealed = created[0]

    process.env.TENANT_DATA_ENCRYPTION = 'no'
    mockKms(null)
    expect(sealed.sessionSecretEncrypted).toEqual(expect.any(String))

    // Handing the envelope back as if it were the secret would authenticate nothing and look like
    // a wrong password; null at least routes the caller to re-issue the session key.
    await expect(findSessionApiKeyWithSecret(em as never, 'sess_alice')).resolves.toBeNull()
  })

  it('recovers a secret written in the clear after encryption is switched back on', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    mockKms(null)
    const { em, created } = buildEm()
    await createSessionApiKey(em as never, {
      sessionToken: 'sess_alice',
      userId: 'user-alice',
      userRoles: ['admin'],
      tenantId: TENANT,
      organizationId: 'org-1',
    })
    const plaintext = created[0].sessionSecretEncrypted

    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    mockKms(generateDek())

    // The mirror of the case above. `decryptWithAesGcm` reads plaintext as a malformed envelope and
    // returns null, so without a shape check the flip would break every live session rather than
    // only the ones sealed under the old setting.
    const result = await findSessionApiKeyWithSecret(em as never, 'sess_alice')
    expect(result?.secret).toBe(plaintext)
  })
})

describe('session secret owner eligibility', () => {
  async function fixture() {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    mockKms(generateDek())
    const fixture = buildEm()
    await createSessionApiKey(fixture.em as never, {
      sessionToken: 'sess_alice', userId: 'user-alice', userRoles: ['admin'],
      tenantId: TENANT, organizationId: 'org-1',
    })
    mockDecryptWithAesGcm.mockClear()
    return fixture
  }

  it.each([
    ['deactivated', { isConfirmed: false }],
    ['deleted', { deletedAt: new Date() }],
    ['another tenant', { tenantId: 'tenant-2' }],
    ['another organization', { organizationId: 'org-2' }],
  ])('denies an owner who is %s before touching the secret', async (_label, changes) => {
    const { em, owner } = await fixture()
    Object.assign(owner, changes)
    await expect(findSessionApiKeyWithSecret(em as never, 'sess_alice')).resolves.toBeNull()
    expect(mockDecryptWithAesGcm).not.toHaveBeenCalled()
  })

  it.each([null, '', '  ', 'missing-owner'])('denies a missing owner (%s) without creator fallback', async (ownerId) => {
    const { em, created } = await fixture()
    created[0].sessionUserId = ownerId
    await expect(findSessionApiKeyWithSecret(em as never, 'sess_alice')).resolves.toBeNull()
    expect(mockDecryptWithAesGcm).not.toHaveBeenCalled()
  })

  it.each([
    ['inactive', { isActive: false }],
    ['deleted', { deletedAt: new Date() }],
    ['missing', { id: 'tenant-2' }],
  ])('denies an %s tenant before decrypting', async (_label, changes) => {
    const { em, tenant } = await fixture()
    Object.assign(tenant, changes)
    await expect(findSessionApiKeyWithSecret(em as never, 'sess_alice')).resolves.toBeNull()
    expect(mockDecryptWithAesGcm).not.toHaveBeenCalled()
  })

  it('rechecks live owner and tenant state after a successful recovery on the same EM', async () => {
    const { em, owner } = await fixture()
    expect(await findSessionApiKeyWithSecret(em as never, 'sess_alice')).not.toBeNull()
    expect(em.findOne).toHaveBeenCalledWith(User, {
      id: owner.id, tenantId: TENANT, organizationId: 'org-1', isConfirmed: true, deletedAt: null,
    }, { refresh: true })
    expect(em.findOne).toHaveBeenCalledWith(Tenant, {
      id: TENANT, isActive: true, deletedAt: null,
    }, { refresh: true })
    owner.isConfirmed = false
    mockDecryptWithAesGcm.mockClear()
    await expect(findSessionApiKeyWithSecret(em as never, 'sess_alice')).resolves.toBeNull()
    expect(mockDecryptWithAesGcm).not.toHaveBeenCalled()
  })

  it('propagates an unavailable owner lookup without decrypting', async () => {
    const { em, created } = await fixture()
    em.findOne.mockImplementation(async (entity) => {
      if (entity === ApiKey) return created[0]
      throw new Error('[internal] database unavailable')
    })
    await expect(findSessionApiKeyWithSecret(em as never, 'sess_alice')).rejects.toThrow('database unavailable')
    expect(mockDecryptWithAesGcm).not.toHaveBeenCalled()
  })
})
