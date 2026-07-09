/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { decryptWithAesGcm, encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { EncryptionMap } from '../../../entities/data/entities'
import { IntegrationCredentials } from '../../data/entities'
import {
  buildCredentialsFilter,
  createCredentialsService,
  CredentialsEncryptionUnavailableError,
} from '../credentials-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
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
      if (entity === EncryptionMap) return null
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
