/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'
import {
  clearRegisteredIntegrations,
  registerIntegration,
  type IntegrationScope,
} from '@open-mercato/shared/modules/integrations/types'
import { decryptWithAesGcm, encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { IntegrationCredentials } from '../../data/entities'
import {
  buildCredentialsFilter,
  bundleFallthroughId,
  createCredentialsService,
  CredentialsEncryptionUnavailableError,
  ensureCredentialsEncryptionMap,
  eraseIntegrationCredentials,
  isReservedOAuthGrantId,
  readCredentialRowLayered,
} from '../credentials-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

// `resolveEncryptionMode` stays real: it is the function under test on the disabled/unavailable
// split, and it reads only the env toggle plus the mocked KMS's `isHealthy()`.
jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/kms'),
  createKmsService: jest.fn(),
}))

const mockFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockCreateKmsService = createKmsService as jest.MockedFunction<typeof createKmsService>

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }
const encryptedBlobKey = '__om_encrypted_credentials_blob_v1'

function mockKms(dek: string | null) {
  mockCreateKmsService.mockReturnValue({
    isHealthy: () => Boolean(dek),
    getTenantDek: jest.fn(async (tenantId: string) => dek ? { tenantId, key: dek, fetchedAt: Date.now() } : null),
    createTenantDek: jest.fn(async (tenantId: string) => dek ? { tenantId, key: dek, fetchedAt: Date.now() } : null),
  })
}

function createMockEntityManager() {
  const persisted: unknown[] = []
  const em = {
    create: jest.fn((_Entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn((entity: unknown) => {
      persisted.push(entity)
      return em
    }),
    flush: jest.fn(async () => undefined),
    execute: jest.fn(async () => [{ id: 'map-1', updated_at: new Date() }]),
  }
  return { em, persisted }
}

/**
 * The credential where-filter IS the per-user / tenant isolation boundary:
 * `findOneWithDecryption` applies it verbatim as the SQL where-clause, so an
 * explicit `userId: null` means `user_id IS NULL` (tenant-wide rows only) and a
 * concrete `userId` pins the lookup to a single owner. These assertions lock the
 * branch so a regression can never silently widen one scope into another's rows.
 */
describe('buildCredentialsFilter (per-user / tenant isolation)', () => {
  const tenantScope: IntegrationScope = { tenantId: 't1', organizationId: 'o1' }
  const userScope: IntegrationScope = { tenantId: 't1', organizationId: 'o1', userId: 'user-a' }

  it('scopes a tenant-wide lookup to user_id = null', () => {
    expect(buildCredentialsFilter('gmail', tenantScope)).toEqual({
      integrationId: 'gmail',
      organizationId: 'o1',
      tenantId: 't1',
      deletedAt: null,
      userId: null,
    })
  })

  it('pins a per-user lookup to that exact user_id within the tenant/org', () => {
    const filter = buildCredentialsFilter('gmail', userScope)
    expect(filter.userId).toBe('user-a')
    expect(filter.tenantId).toBe('t1')
    expect(filter.organizationId).toBe('o1')
    expect(filter.integrationId).toBe('gmail')
  })

  it('emits an explicit null userId for tenant-wide scope so user-owned rows are excluded', () => {
    const filter = buildCredentialsFilter('gmail', tenantScope)
    expect('userId' in filter).toBe(true)
    expect(filter.userId).toBeNull()
  })

  it('isolates two users on the same tenant into distinct filters', () => {
    const a = buildCredentialsFilter('gmail', { tenantId: 't1', organizationId: 'o1', userId: 'user-a' })
    const b = buildCredentialsFilter('gmail', { tenantId: 't1', organizationId: 'o1', userId: 'user-b' })
    expect(a.userId).toBe('user-a')
    expect(b.userId).toBe('user-b')
    expect(a.userId).not.toBe(b.userId)
  })

  it('treats userId null and userId undefined identically (tenant-wide)', () => {
    const withNull = buildCredentialsFilter('gmail', { tenantId: 't1', organizationId: 'o1', userId: null })
    const withUndefined = buildCredentialsFilter('gmail', { tenantId: 't1', organizationId: 'o1' })
    expect(withNull.userId).toBeNull()
    expect(withUndefined.userId).toBeNull()
  })
})

describe('integration credentials service encryption', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('encrypts credentials only with a DEK resolved from KMS', async () => {
    const dek = generateDek()
    mockKms(dek)
    mockFindOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === IntegrationCredentials) return null
      return null
    })
    const { em, persisted } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    await service.save('gateway_test', { apiKey: 'sk_test_secret' }, scope)

    const credentialsRow = persisted.find((row) =>
      typeof row === 'object'
      && row !== null
      && (row as { integrationId?: unknown }).integrationId === 'gateway_test'
    ) as { credentials?: Record<string, unknown> } | undefined

    expect(credentialsRow?.credentials).toEqual({
      [encryptedBlobKey]: expect.any(String),
    })
    const decrypted = decryptWithAesGcm(String(credentialsRow?.credentials?.[encryptedBlobKey]), dek)
    expect(JSON.parse(String(decrypted))).toEqual({ apiKey: 'sk_test_secret' })
  })

  it('fails closed before touching storage when no credential DEK is available', async () => {
    mockKms(null)
    const { em, persisted } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    await expect(service.save('gateway_test', { apiKey: 'sk_test_secret' }, scope))
      .rejects
      .toBeInstanceOf(CredentialsEncryptionUnavailableError)

    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(persisted).toEqual([])
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not require KMS when no credentials row exists', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const { em } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    await expect(service.getRaw('gateway_test', scope)).resolves.toBeNull()

    expect(mockCreateKmsService).not.toHaveBeenCalled()
  })

  it('fails closed when encrypted credentials exist but no DEK is available', async () => {
    const dek = generateDek()
    const encrypted = encryptWithAesGcm(JSON.stringify({ apiKey: 'sk_test_secret' }), dek).value
    mockKms(null)
    mockFindOneWithDecryption.mockResolvedValue({
      credentials: { [encryptedBlobKey]: encrypted },
    } as never)
    const { em } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    await expect(service.getRaw('gateway_test', scope))
      .rejects
      .toBeInstanceOf(CredentialsEncryptionUnavailableError)
  })

  it('returns the record as-is when the row has no encrypted blob marker, even if KMS is unavailable', async () => {
    mockKms(null)
    mockFindOneWithDecryption.mockResolvedValueOnce({
      credentials: { apiKey: 'legacy-plain' },
    } as never)
    const { em } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    await expect(service.getRaw('gateway_test', scope)).resolves.toEqual({ apiKey: 'legacy-plain' })
  })

  it('error carries a stable code so HTTP routes can identify it', () => {
    const err = new CredentialsEncryptionUnavailableError('tenant-7')
    expect(err.code).toBe('CREDENTIALS_ENCRYPTION_UNAVAILABLE')
    expect(err.message).toContain('tenant-7')
    expect(err).toBeInstanceOf(Error)
  })

  it('source file no longer contains the hardcoded emergency fallback literal', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'credentials-service.ts'),
      'utf8',
    )
    expect(source).not.toContain('om-emergency-fallback-rotate-me')
  })
})

describe('integration credentials encryption-map materialization', () => {
  it('uses conflict-safe upserts and invalidates the canonical scope under concurrent first saves', async () => {
    const rows = new Map<string, { id: string; updated_at: Date }>()
    let arrivals = 0
    let release: (() => void) | undefined
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve
    })
    const execute = jest.fn(async (_sql: string, params: readonly unknown[]) => {
      arrivals += 1
      if (arrivals === 2) release?.()
      await bothArrived
      const key = `${String(params[0])}:${String(params[1])}:${String(params[2])}`
      const saved = rows.get(key) ?? { id: 'canonical-map', updated_at: new Date() }
      rows.set(key, saved)
      return [saved]
    })
    const em = { execute } as never
    const invalidateMap = jest.fn(async () => undefined)

    await Promise.all([
      ensureCredentialsEncryptionMap(em, scope, { invalidateMap }),
      ensureCredentialsEncryptionMap(em, scope, { invalidateMap }),
    ])

    expect(rows.size).toBe(1)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls.every(([sql]) => String(sql).includes('on conflict'))).toBe(true)
    expect(invalidateMap).toHaveBeenCalledTimes(2)
    expect(invalidateMap).toHaveBeenCalledWith(
      'integrations:integration_credentials',
      scope.tenantId,
      scope.organizationId,
    )
  })

  it('exposes additive post-commit deferral without invalidating inside the caller transaction', async () => {
    const { em } = createMockEntityManager()
    const invalidateMap = jest.fn(async () => undefined)
    const afterCommitCallbacks: Array<() => void | Promise<void>> = []

    await ensureCredentialsEncryptionMap(em as never, scope, { invalidateMap }, {
      deferAfterCommit: (callback) => afterCommitCallbacks.push(callback),
    })

    expect(invalidateMap).not.toHaveBeenCalled()
    expect(afterCommitCallbacks).toHaveLength(1)

    await afterCommitCallbacks[0]?.()

    expect(invalidateMap).toHaveBeenCalledWith(
      'integrations:integration_credentials',
      scope.tenantId,
      scope.organizationId,
    )
  })
})

/**
 * `TENANT_DATA_ENCRYPTION=no` is a supported deployment, not an outage.
 *
 * Both states hand the KMS factory a service that produces no DEK, which is why this path used to
 * answer 503 for an operator who had simply opted out: `getTenantDek` returning null looks the
 * same either way. The distinction is the env toggle, and only the outage half may fail closed —
 * degrading a secret to plaintext because Vault blinked is the downgrade the fail-closed rule
 * exists to prevent (spec 2026-05-29, security finding #7).
 */
describe('integration credentials with tenant data encryption disabled', () => {
  const previousToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TENANT_DATA_ENCRYPTION = 'no'
  })

  afterEach(() => {
    if (previousToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousToggle
  })

  it('stores credentials as plaintext instead of answering 503', async () => {
    mockKms(null)
    mockFindOneWithDecryption.mockResolvedValue(null)
    const { em, persisted } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    await service.save('gateway_test', { apiKey: 'sk_test_secret' }, scope)

    const credentialsRow = persisted.find((row) =>
      typeof row === 'object'
      && row !== null
      && (row as { integrationId?: unknown }).integrationId === 'gateway_test'
    ) as { credentials?: Record<string, unknown> } | undefined

    expect(credentialsRow?.credentials).toEqual({ apiKey: 'sk_test_secret' })
    expect(credentialsRow?.credentials).not.toHaveProperty(encryptedBlobKey)
  })

  it('round-trips a plaintext blob through getRaw', async () => {
    mockKms(null)
    mockFindOneWithDecryption.mockResolvedValue({
      credentials: { apiKey: 'sk_test_secret' },
    } as never)
    const { em } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    await expect(service.getRaw('gateway_test', scope)).resolves.toEqual({ apiKey: 'sk_test_secret' })
  })

  it('still refuses to guess at a blob sealed before the toggle was flipped', async () => {
    const dek = generateDek()
    const encrypted = encryptWithAesGcm(JSON.stringify({ apiKey: 'sk_test_secret' }), dek).value
    mockKms(null)
    mockFindOneWithDecryption.mockResolvedValue({
      credentials: { [encryptedBlobKey]: encrypted },
    } as never)
    const { em } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    // Returning the envelope, or an empty credential set, would hand the adapter a silently broken
    // secret. Say what happened instead -- and name a remedy that exists: `decrypt-database` does
    // NOT unseal this blob (it decrypts the columns an encryption map covers, and this envelope
    // sits inside the decrypted value), so an operator who follows that advice lands right back
    // here. Re-entering the credentials is what actually works.
    const error = await service.getRaw('gateway_test', scope).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(CredentialsEncryptionUnavailableError)
    expect((error as CredentialsEncryptionUnavailableError).reason).toBe('sealed-while-disabled')
    expect((error as Error).message).toContain('re-enter the credentials')
    expect((error as Error).message).toContain('does not reach this blob')
  })

  it('keeps failing closed when encryption is ON but the KMS is merely unreachable', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    mockKms(null)
    const { em, persisted } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    const error = await service
      .save('gateway_test', { apiKey: 'sk_test_secret' }, scope)
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(CredentialsEncryptionUnavailableError)
    expect((error as CredentialsEncryptionUnavailableError).reason).toBe('no-dek')
    expect(persisted).toEqual([])
  })
})

/**
 * Read-path fallback — the `OR user_id IS NULL` half of the spec's
 * `WHERE user_id = currentUser.id OR user_id IS NULL` lookup. A user-scoped read
 * of a tenant-wide integration (sync_excel, Stripe, Akeneo, S3, the channel OAuth
 * *client* config) must still find the shared row, while the per-user row keeps
 * precedence and a tenant-wide read never widens into user-owned rows.
 */
describe('getRaw per-user → tenant-wide fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const userScope: IntegrationScope = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-a' }

  it('falls back to the tenant-wide (user_id = null) row when the user has none of their own', async () => {
    const dek = generateDek()
    mockKms(dek)
    const encrypted = encryptWithAesGcm(JSON.stringify({ apiKey: 'shared-tenant-key' }), dek).value
    mockFindOneWithDecryption
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ credentials: { [encryptedBlobKey]: encrypted } } as never)
    const { em } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    await expect(service.getRaw('sync_excel', userScope)).resolves.toEqual({ apiKey: 'shared-tenant-key' })

    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(2)
    expect((mockFindOneWithDecryption.mock.calls[0][2] as { userId?: unknown }).userId).toBe('user-a')
    expect((mockFindOneWithDecryption.mock.calls[1][2] as { userId?: unknown }).userId).toBeNull()
  })

  it('returns the per-user row without falling back when one exists (per-user precedence)', async () => {
    const dek = generateDek()
    mockKms(dek)
    const encrypted = encryptWithAesGcm(JSON.stringify({ apiKey: 'user-a-key' }), dek).value
    mockFindOneWithDecryption.mockResolvedValueOnce({ credentials: { [encryptedBlobKey]: encrypted } } as never)
    const { em } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    await expect(service.getRaw('channel_gmail', userScope)).resolves.toEqual({ apiKey: 'user-a-key' })
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('does not attempt a fallback for a tenant-wide scope (no userId)', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const { em } = createMockEntityManager()
    const service = createCredentialsService(em as never)

    await expect(service.getRaw('sync_excel', scope)).resolves.toBeNull()
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
  })
})

describe('createCredentialsService kms option', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function optionKms(dek: string) {
    return {
      isHealthy: () => true,
      getTenantDek: jest.fn(async (tenantId: string) => ({ tenantId, key: dek, fetchedAt: Date.now() })),
      createTenantDek: jest.fn(async () => null),
    }
  }

  it('seals with the option KMS while the second parameter stays the map invalidator', async () => {
    const optionDek = generateDek()
    mockKms(generateDek())
    mockFindOneWithDecryption.mockResolvedValue(null)
    const kms = optionKms(optionDek)
    const invalidateMap = jest.fn(async () => undefined)
    const { em, persisted } = createMockEntityManager()
    const service = createCredentialsService(em as never, { invalidateMap }, { kms })

    await service.save('gateway_test', { apiKey: 'sk_test_secret' }, scope)

    const row = persisted[0] as { credentials: Record<string, unknown> }
    const decrypted = decryptWithAesGcm(String(row.credentials[encryptedBlobKey]), optionDek)
    expect(JSON.parse(String(decrypted))).toEqual({ apiKey: 'sk_test_secret' })
    expect(mockCreateKmsService).not.toHaveBeenCalled()
    expect(kms.getTenantDek).toHaveBeenCalledWith(scope.tenantId)
    expect(invalidateMap).toHaveBeenCalledWith('integrations:integration_credentials', scope.tenantId, scope.organizationId)
  })

  it('opens the envelope on getRaw with the option KMS', async () => {
    const optionDek = generateDek()
    const encrypted = encryptWithAesGcm(JSON.stringify({ apiKey: 'sk_test_secret' }), optionDek).value
    mockFindOneWithDecryption.mockResolvedValue({ credentials: { [encryptedBlobKey]: encrypted } } as never)
    const { em } = createMockEntityManager()
    const service = createCredentialsService(em as never, null, { kms: optionKms(optionDek) })

    await expect(service.getRaw('gateway_test', scope)).resolves.toEqual({ apiKey: 'sk_test_secret' })
    expect(mockCreateKmsService).not.toHaveBeenCalled()
  })
})

describe('ensureCredentialsEncryptionMap when-not-canonical', () => {
  it('reads the live map and skips the upsert and the invalidation when it is canonical', async () => {
    const execute = jest.fn(async () => [{ id: 'canonical-map' }])
    const invalidateMap = jest.fn(async () => undefined)
    const deferred: Array<() => void | Promise<void>> = []

    await ensureCredentialsEncryptionMap({ execute } as never, scope, { invalidateMap }, {
      ensureEncryptionMap: 'when-not-canonical',
      deferAfterCommit: (callback) => deferred.push(callback),
    })

    expect(execute).toHaveBeenCalledTimes(1)
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toMatch(/^\s*select/i)
    expect(sql).not.toContain('on conflict')
    expect(params).toEqual([
      'integrations:integration_credentials',
      scope.tenantId,
      scope.organizationId,
      JSON.stringify([{ field: 'credentials' }]),
    ])
    expect(deferred).toHaveLength(0)
    expect(invalidateMap).not.toHaveBeenCalled()
  })

  it('upserts and defers the invalidation when the live map is missing, inactive or not canonical', async () => {
    const execute = jest.fn(async (sql: string) => (
      String(sql).includes('on conflict') ? [{ id: 'canonical-map', updated_at: new Date() }] : []
    ))
    const invalidateMap = jest.fn(async () => undefined)
    const deferred: Array<() => void | Promise<void>> = []

    await ensureCredentialsEncryptionMap({ execute } as never, scope, { invalidateMap }, {
      ensureEncryptionMap: 'when-not-canonical',
      deferAfterCommit: (callback) => deferred.push(callback),
    })

    expect(execute).toHaveBeenCalledTimes(2)
    expect(String(execute.mock.calls[1]?.[0])).toContain('on conflict')
    expect(deferred).toHaveLength(1)
    await deferred[0]?.()
    expect(invalidateMap).toHaveBeenCalledTimes(1)
  })

  it('keeps upserting without a read by default', async () => {
    const execute = jest.fn(async () => [{ id: 'canonical-map', updated_at: new Date() }])

    await ensureCredentialsEncryptionMap({ execute } as never, scope, { invalidateMap: jest.fn(async () => undefined) })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(String((execute.mock.calls[0] as unknown as [string])[0])).toContain('on conflict')
  })
})

describe('eraseIntegrationCredentials', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function createEraseEntityManager(found: { id: string } | null) {
    const managed = { id: found?.id, credentials: { apiKey: 'sk_test_secret' } as Record<string, unknown>, deletedAt: null as Date | null }
    const em = {
      findOne: jest.fn(async () => found),
      getReference: jest.fn(() => managed),
      flush: jest.fn(async () => undefined),
    }
    return { em, managed }
  }

  it('blanks and soft-deletes the strict row found by an id-only lookup, without a DEK', async () => {
    const { em, managed } = createEraseEntityManager({ id: 'row-1' })

    await expect(eraseIntegrationCredentials(em as never, 'gateway_test', scope)).resolves.toBe(true)

    expect(em.findOne).toHaveBeenCalledWith(
      IntegrationCredentials,
      buildCredentialsFilter('gateway_test', scope),
      { fields: ['id', 'tenantId', 'organizationId'] },
    )
    expect(em.getReference).toHaveBeenCalledWith(IntegrationCredentials, 'row-1')
    expect(managed.credentials).toEqual({})
    expect(managed.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(mockCreateKmsService).not.toHaveBeenCalled()
  })

  it('returns false without a flush when no live row exists', async () => {
    const { em } = createEraseEntityManager(null)

    await expect(eraseIntegrationCredentials(em as never, 'gateway_test', scope)).resolves.toBe(false)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('keeps the lookup strict for a per-user scope', async () => {
    const { em } = createEraseEntityManager(null)
    const userScope = { ...scope, userId: 'user-a' }

    await eraseIntegrationCredentials(em as never, 'gateway_test', userScope)

    expect(em.findOne).toHaveBeenCalledTimes(1)
    expect((em.findOne.mock.calls[0] as unknown as [unknown, { userId?: unknown }])[1].userId).toBe('user-a')
  })
})

describe('readCredentialRowLayered', () => {
  const previousToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
  })

  afterEach(() => {
    if (previousToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousToggle
  })

  type Stub = { apiKey: string }
  const validate = (value: Record<string, unknown>): Stub | null => (
    typeof value.apiKey === 'string' ? { apiKey: value.apiKey } : null
  )

  function readKms(dek: string | null) {
    return {
      isHealthy: () => true,
      getTenantDek: jest.fn(async (tenantId: string) => dek ? { tenantId, key: dek, fetchedAt: Date.now() } : null),
      createTenantDek: jest.fn(async () => null),
    }
  }

  function storedRow(credentials: unknown) {
    mockFindOneWithDecryption.mockResolvedValue({ id: 'row-1', credentials } as never)
  }

  function sealed(value: unknown, dek: string) {
    return { [encryptedBlobKey]: encryptWithAesGcm(JSON.stringify(value), dek).value }
  }

  it('reads the strict row and returns none when it is missing', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const userScope = { ...scope, userId: 'user-a' }

    await expect(readCredentialRowLayered({} as never, 'gateway_test', userScope, { kms: readKms(null), validate }))
      .resolves.toEqual({ kind: 'none' })
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    expect((mockFindOneWithDecryption.mock.calls[0][2] as { userId?: unknown }).userId).toBe('user-a')
  })

  it('returns field_ciphertext when the field-level layer stayed sealed', async () => {
    storedRow(encryptWithAesGcm(JSON.stringify({ apiKey: 'x' }), generateDek()).value)
    const kms = readKms(generateDek())

    await expect(readCredentialRowLayered({} as never, 'gateway_test', scope, { kms, validate }))
      .resolves.toEqual({ kind: 'field_ciphertext', rowId: 'row-1' })
    expect(kms.getTenantDek).not.toHaveBeenCalled()
  })

  it('returns no_dek when the KMS has no key, and sealed-while-disabled with encryption off', async () => {
    storedRow(sealed({ apiKey: 'x' }, generateDek()))

    const missingKeyKms = readKms(null)
    await expect(readCredentialRowLayered({} as never, 'gateway_test', scope, { kms: missingKeyKms, validate }))
      .resolves.toEqual({ kind: 'no_dek', rowId: 'row-1', reason: 'no-dek' })
    expect(missingKeyKms.createTenantDek).not.toHaveBeenCalled()

    process.env.TENANT_DATA_ENCRYPTION = 'no'
    await expect(readCredentialRowLayered({} as never, 'gateway_test', scope, { kms: readKms(generateDek()), validate }))
      .resolves.toEqual({ kind: 'no_dek', rowId: 'row-1', reason: 'sealed-while-disabled' })
  })

  it('returns envelope_undecryptable when the envelope does not open under the DEK', async () => {
    storedRow(sealed({ apiKey: 'x' }, generateDek()))

    await expect(readCredentialRowLayered({} as never, 'gateway_test', scope, { kms: readKms(generateDek()), validate }))
      .resolves.toEqual({ kind: 'envelope_undecryptable', rowId: 'row-1' })
  })

  it('returns invalid parse for a non-object blob and invalid schema when validate rejects it', async () => {
    const dek = generateDek()
    storedRow({ [encryptedBlobKey]: encryptWithAesGcm('not-json', dek).value })
    await expect(readCredentialRowLayered({} as never, 'gateway_test', scope, { kms: readKms(dek), validate }))
      .resolves.toEqual({ kind: 'invalid', rowId: 'row-1', cause: 'parse' })

    storedRow(sealed([1, 2], dek))
    await expect(readCredentialRowLayered({} as never, 'gateway_test', scope, { kms: readKms(dek), validate }))
      .resolves.toEqual({ kind: 'invalid', rowId: 'row-1', cause: 'parse' })

    storedRow(sealed({}, dek))
    await expect(readCredentialRowLayered({} as never, 'gateway_test', scope, { kms: readKms(dek), validate }))
      .resolves.toEqual({ kind: 'invalid', rowId: 'row-1', cause: 'schema' })
  })

  it('returns ok for a sealed blob and for a plain row without asking the KMS', async () => {
    const dek = generateDek()
    storedRow(sealed({ apiKey: 'sealed' }, dek))
    await expect(readCredentialRowLayered({} as never, 'gateway_test', scope, { kms: readKms(dek), validate }))
      .resolves.toEqual({ kind: 'ok', rowId: 'row-1', value: { apiKey: 'sealed' } })

    const kms = readKms(null)
    storedRow({ apiKey: 'plain' })
    await expect(readCredentialRowLayered({} as never, 'gateway_test', scope, { kms, validate }))
      .resolves.toEqual({ kind: 'ok', rowId: 'row-1', value: { apiKey: 'plain' } })
    expect(kms.getTenantDek).not.toHaveBeenCalled()
    expect(mockCreateKmsService).not.toHaveBeenCalled()
  })
})

describe('bundleFallthroughId', () => {
  beforeEach(() => {
    clearRegisteredIntegrations()
  })

  afterAll(() => {
    clearRegisteredIntegrations()
  })

  it('returns the bundle of a child integration and null without one', () => {
    registerIntegration({ id: 'child_plain', title: 'Child', bundleId: 'bundle_plain' })
    registerIntegration({ id: 'standalone', title: 'Standalone' })

    expect(bundleFallthroughId('child_plain')).toBe('bundle_plain')
    expect(bundleFallthroughId('standalone')).toBeNull()
    expect(bundleFallthroughId('not_registered')).toBeNull()
  })

  it('never falls through to a bundleId ending in the reserved __oauth_grant suffix', () => {
    registerIntegration({ id: 'child_grant', title: 'Child', bundleId: 'test_oauth_grant__oauth_grant' })
    registerIntegration({ id: 'child_versioned', title: 'Child', bundleId: 'x__oauth_grant_v2' })

    expect(bundleFallthroughId('child_grant')).toBeNull()
    expect(bundleFallthroughId('child_versioned')).toBe('x__oauth_grant_v2')
  })
})

describe('resolve and resolveUpdatedAt bundle fallthrough', () => {
  type StoredRow = { id: string; credentials: Record<string, unknown>; updatedAt: Date }
  const storedRows = new Map<string, StoredRow>()
  const grantRowId = 'test_oauth_grant__oauth_grant'
  const grantRow: StoredRow = {
    id: 'grant-row',
    credentials: { accessToken: 'fake_at_grant', refreshToken: 'fake_rt_grant' },
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
  }

  function storeRow(integrationId: string, row: StoredRow): void {
    storedRows.set(integrationId, row)
  }

  function lookedUpIntegrationIds(): string[] {
    return mockFindOneWithDecryption.mock.calls.map(([, , where]) => String((where as { integrationId?: unknown }).integrationId))
  }

  beforeEach(() => {
    jest.clearAllMocks()
    clearRegisteredIntegrations()
    storedRows.clear()
    mockKms(null)
    mockFindOneWithDecryption.mockImplementation(async (_em, _entity, where) => (
      storedRows.get(String((where as { integrationId?: unknown }).integrationId)) ?? null
    ) as never)
  })

  afterAll(() => {
    clearRegisteredIntegrations()
  })

  it('still falls through to a regular bundle', async () => {
    const bundleRow = { id: 'bundle-row', credentials: { apiKey: 'bundle-key' }, updatedAt: new Date('2026-10-02T10:00:00.000Z') }
    registerIntegration({ id: 'child_plain', title: 'Child', bundleId: 'bundle_plain' })
    storeRow('bundle_plain', bundleRow)
    const service = createCredentialsService({} as never)

    await expect(service.resolve('child_plain', scope)).resolves.toEqual({ apiKey: 'bundle-key' })
    await expect(service.resolveUpdatedAt('child_plain', scope)).resolves.toEqual(bundleRow.updatedAt)
    expect(lookedUpIntegrationIds()).toEqual(['child_plain', 'bundle_plain', 'child_plain', 'bundle_plain'])
  })

  it('returns null for a bundleId ending in __oauth_grant, with no read of that id', async () => {
    registerIntegration({ id: 'child_grant', title: 'Child', bundleId: grantRowId })
    storeRow(grantRowId, grantRow)
    const service = createCredentialsService({} as never)

    await expect(service.resolve('child_grant', scope)).resolves.toBeNull()
    await expect(service.resolveUpdatedAt('child_grant', scope)).resolves.toBeNull()
    expect(lookedUpIntegrationIds()).toEqual(['child_grant', 'child_grant'])
    expect(mockCreateKmsService).not.toHaveBeenCalled()
  })

  it('prefers the integration own row over any bundle', async () => {
    const ownRow = { id: 'own-row', credentials: { apiKey: 'own-key' }, updatedAt: new Date('2026-10-03T10:00:00.000Z') }
    registerIntegration({ id: 'child_grant', title: 'Child', bundleId: grantRowId })
    storeRow('child_grant', ownRow)
    storeRow(grantRowId, grantRow)
    const service = createCredentialsService({} as never)

    await expect(service.resolve('child_grant', scope)).resolves.toEqual({ apiKey: 'own-key' })
    await expect(service.resolveUpdatedAt('child_grant', scope)).resolves.toEqual(ownRow.updatedAt)
    expect(lookedUpIntegrationIds()).toEqual(['child_grant', 'child_grant'])
  })

  it('still falls through to a bundleId that only contains the suffix', async () => {
    const versionedRow = { id: 'versioned-row', credentials: { apiKey: 'versioned-key' }, updatedAt: new Date('2026-10-04T10:00:00.000Z') }
    registerIntegration({ id: 'child_versioned', title: 'Child', bundleId: 'x__oauth_grant_v2' })
    storeRow('x__oauth_grant_v2', versionedRow)
    const service = createCredentialsService({} as never)

    await expect(service.resolve('child_versioned', scope)).resolves.toEqual({ apiKey: 'versioned-key' })
    await expect(service.resolveUpdatedAt('child_versioned', scope)).resolves.toEqual(versionedRow.updatedAt)
  })
})

describe('isReservedOAuthGrantId', () => {
  it('matches only ids ending in the __oauth_grant suffix', () => {
    expect(isReservedOAuthGrantId('test_oauth_grant__oauth_grant')).toBe(true)
    expect(isReservedOAuthGrantId('__oauth_grant')).toBe(true)
    expect(isReservedOAuthGrantId('x__oauth_grant_v2')).toBe(false)
    expect(isReservedOAuthGrantId('test_oauth_grant')).toBe(false)
  })
})
