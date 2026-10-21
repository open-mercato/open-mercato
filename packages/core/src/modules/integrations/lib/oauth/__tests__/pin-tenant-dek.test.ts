/** @jest-environment node */
import { decryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createKmsService, type KmsService, type TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { createCredentialsService } from '../../credentials-service'
import { pinTenantDek } from '../pin-tenant-dek'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const mockFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ENVELOPE_KEY = '__om_encrypted_credentials_blob_v1'
const ENV_NAMES = [
  'TENANT_DATA_ENCRYPTION',
  'TENANT_DATA_ENCRYPTION_FALLBACK_KEY',
  'TENANT_DATA_ENCRYPTION_KEY',
  'VAULT_ADDR',
  'VAULT_TOKEN',
  'VAULT_KV_PATH',
] as const

type StubKms = KmsService & {
  calls: { getTenantDek: number; createTenantDek: number; invalidateDek: number }
}

function dekFor(tenantId: string, key: string): TenantDek {
  return { tenantId, key, fetchedAt: Date.now() }
}

function createStubKms(answers: {
  existing?: string | null
  created?: string | null
  throws?: Error
}): StubKms {
  const calls = { getTenantDek: 0, createTenantDek: 0, invalidateDek: 0 }
  return {
    calls,
    isHealthy: () => true,
    async getTenantDek(tenantId) {
      calls.getTenantDek += 1
      if (answers.throws) throw answers.throws
      return answers.existing ? dekFor(tenantId, answers.existing) : null
    },
    async createTenantDek(tenantId) {
      calls.createTenantDek += 1
      return answers.created ? dekFor(tenantId, answers.created) : null
    },
    invalidateDek() {
      calls.invalidateDek += 1
    },
  }
}

type PersistedRow = { credentials: Record<string, unknown> }

type MockEntityManager = {
  create: (entity: unknown, data: PersistedRow) => PersistedRow
  persist: (entity: PersistedRow) => MockEntityManager
  flush: () => Promise<void>
  execute: () => Promise<Array<{ id: string; updated_at: Date }>>
}

function createMockEntityManager(): { em: MockEntityManager; persisted: PersistedRow[] } {
  const persisted: PersistedRow[] = []
  const em: MockEntityManager = {
    create: (_entity, data) => ({ ...data }),
    persist: (entity) => {
      persisted.push(entity)
      return em
    },
    flush: async () => undefined,
    execute: async () => [{ id: 'map-1', updated_at: new Date() }],
  }
  return { em, persisted }
}

describe('pinTenantDek', () => {
  const previousEnv = new Map<string, string | undefined>(ENV_NAMES.map((name) => [name, process.env[name]]))

  beforeEach(() => {
    jest.restoreAllMocks()
    mockFindOneWithDecryption.mockReset()
    for (const name of ENV_NAMES) delete process.env[name]
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
  })

  afterAll(() => {
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('keeps sealing with the pinned Vault key after Vault starts failing behind a fallback key (A9)', async () => {
    const vaultKey = generateDek()
    process.env.VAULT_ADDR = 'http://vault.test'
    process.env.VAULT_TOKEN = 'vault-token'
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = 'pin-test-fallback-secret'
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { data: { key: vaultKey } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockRejectedValue(new Error('[internal] vault unreachable'))
    const kms = createKmsService()
    const pin = pinTenantDek(kms)

    await expect(pin.resolve(TENANT_ID)).resolves.toEqual({ status: 'pinned' })
    kms.invalidateDek?.(TENANT_ID)
    const unpinnedKey = (await kms.getTenantDek(TENANT_ID))?.key
    expect(unpinnedKey).toBeDefined()
    expect(unpinnedKey).not.toBe(vaultKey)
    const fetchCallsAfterOutage = fetchMock.mock.calls.length

    mockFindOneWithDecryption.mockResolvedValue(null)
    const { em, persisted } = createMockEntityManager()
    const invalidateMap = jest.fn(async () => undefined)
    await createCredentialsService(em as never, { invalidateMap }, { kms: pin })
      .save('test_oauth_grant__oauth_grant', { accessToken: 'secret-value' }, { tenantId: TENANT_ID, organizationId: 'org-1' })

    const envelope = persisted[0]?.credentials[ENVELOPE_KEY]
    expect(typeof envelope).toBe('string')
    expect(decryptWithAesGcm(String(envelope), vaultKey)).toBe(JSON.stringify({ accessToken: 'secret-value' }))
    expect((await pin.getTenantDek(TENANT_ID))?.key).toBe(vaultKey)
    expect((await pin.createTenantDek(TENANT_ID))?.key).toBe(vaultKey)
    expect(fetchMock.mock.calls.length).toBe(fetchCallsAfterOutage)
  })

  it('creates the DEK once when none exists and answers every later request from the memo', async () => {
    const created = generateDek()
    const kms = createStubKms({ existing: null, created })
    const pin = pinTenantDek(kms)

    const outcomes = await Promise.all([pin.resolve(TENANT_ID), pin.resolve(TENANT_ID)])

    expect(outcomes).toEqual([{ status: 'pinned' }, { status: 'pinned' }])
    expect((await pin.getTenantDek(TENANT_ID))?.key).toBe(created)
    expect((await pin.createTenantDek(TENANT_ID))?.key).toBe(created)
    expect(kms.calls).toEqual({ getTenantDek: 1, createTenantDek: 1, invalidateDek: 0 })
  })

  it('answers null with no further KMS call after a resolution without a key', async () => {
    const kms = createStubKms({ existing: null, created: null })
    const pin = pinTenantDek(kms)

    await expect(pin.resolve(TENANT_ID)).resolves.toEqual({ status: 'unavailable', error: null })
    await expect(pin.getTenantDek(TENANT_ID)).resolves.toBeNull()
    await expect(pin.createTenantDek(TENANT_ID)).resolves.toBeNull()
    await expect(pin.resolve(TENANT_ID)).resolves.toEqual({ status: 'unavailable', error: null })
    expect(kms.calls).toEqual({ getTenantDek: 1, createTenantDek: 1, invalidateDek: 0 })
  })

  it('reports a throwing KMS as unavailable with its error and stops calling it', async () => {
    const failure = new Error('[internal] kms down')
    const kms = createStubKms({ throws: failure })
    const pin = pinTenantDek(kms)

    await expect(pin.resolve(TENANT_ID)).resolves.toEqual({ status: 'unavailable', error: failure })
    await expect(pin.getTenantDek(TENANT_ID)).resolves.toBeNull()
    expect(kms.calls.getTenantDek).toBe(1)
  })

  it('resolves nothing while tenant data encryption is disabled', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    const kms = createStubKms({ existing: generateDek() })
    const pin = pinTenantDek(kms)

    await expect(pin.resolve(TENANT_ID)).resolves.toEqual({ status: 'disabled' })
    await expect(pin.getTenantDek(TENANT_ID)).resolves.toBeNull()
    expect(kms.calls.getTenantDek).toBe(0)
  })

  it('delegates isHealthy and invalidateDek to the wrapped KMS', () => {
    const kms = createStubKms({ existing: generateDek() })
    const pin = pinTenantDek(kms)

    expect(pin.isHealthy()).toBe(true)
    pin.invalidateDek?.(TENANT_ID)
    expect(kms.calls.invalidateDek).toBe(1)
  })
})
