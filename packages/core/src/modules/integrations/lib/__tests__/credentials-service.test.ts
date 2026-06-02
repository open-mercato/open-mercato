/** @jest-environment node */

import { decryptWithAesGcm, encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { EncryptionMap } from '../../../entities/data/entities'
import { IntegrationCredentials } from '../../data/entities'
import {
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
})
