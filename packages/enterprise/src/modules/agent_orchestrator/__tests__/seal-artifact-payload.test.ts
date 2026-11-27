import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { KmsService, TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { defaultEncryptionMaps } from '../encryption'
import { ARTIFACT_REFS, getArtifact, putArtifact } from '../lib/trace/artifactStore'
import { getArtifactBytes, putArtifactBytes } from '../lib/runtime/artifactFileStore'
import { sealArtifactPayload } from '../lib/trace/sealArtifactPayload'
import { createTestArtifactEncryption, passThroughArtifactEncryption } from './support/artifactEncryption'

const SCOPE = { tenantId: 't1', organizationId: 'o1' }
const REF = { entityId: 'agent_orchestrator:agent_run', field: 'input' }
const PLAINTEXT = JSON.stringify({ prompt: 'refund order for jane.doe@example.com' })

describe('sealArtifactPayload', () => {
  it('returns the sealed wrapper when the field comes back as an AES-GCM envelope', async () => {
    const encryption = createTestArtifactEncryption()
    const sealed = await sealArtifactPayload(encryption.service, SCOPE, REF, PLAINTEXT)

    expect(sealed).not.toBeNull()
    expect(sealed!.input).not.toBe(PLAINTEXT)
    expect(encryption.openSealedBuffer(Buffer.from(JSON.stringify(sealed)))).toEqual({ input: PLAINTEXT })
  })

  it('passes the ref, payload and scope to the encryption service', async () => {
    const encryption = createTestArtifactEncryption()
    const encryptEntityPayload = jest.fn(encryption.service.encryptEntityPayload)

    await sealArtifactPayload({ encryptEntityPayload }, SCOPE, REF, PLAINTEXT)

    expect(encryptEntityPayload).toHaveBeenCalledWith(REF.entityId, { input: PLAINTEXT }, 't1', 'o1')
  })

  it('returns the plaintext wrapper without calling a service when encryption is turned off', async () => {
    const original = process.env.TENANT_DATA_ENCRYPTION
    process.env.TENANT_DATA_ENCRYPTION = 'false'
    try {
      const encryptEntityPayload = jest.fn()
      expect(await sealArtifactPayload({ encryptEntityPayload }, SCOPE, REF, PLAINTEXT)).toEqual({ input: PLAINTEXT })
      expect(await sealArtifactPayload(null, SCOPE, REF, PLAINTEXT)).toEqual({ input: PLAINTEXT })
      expect(encryptEntityPayload).not.toHaveBeenCalled()
    } finally {
      if (original === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = original
    }
  })

  it('returns null without a service while encryption is on', async () => {
    expect(await sealArtifactPayload(null, SCOPE, REF, PLAINTEXT)).toBeNull()
  })

  it('returns null when the service passes the payload through while encryption is on', async () => {
    expect(await sealArtifactPayload(passThroughArtifactEncryption, SCOPE, REF, PLAINTEXT)).toBeNull()
  })

  it.each([
    ['a missing field', {}],
    ['a null field', { input: null }],
    ['a non-envelope string', { input: 'ENC:something' }],
    ['a forged short envelope', { input: 'aaaa:bbbb:cccc:v1' }],
  ])('returns null for %s', async (_label, result) => {
    const service = { encryptEntityPayload: async () => result }
    expect(await sealArtifactPayload(service, SCOPE, REF, PLAINTEXT)).toBeNull()
  })

  it('propagates encryption errors so callers can log and degrade', async () => {
    const service = {
      encryptEntityPayload: async () => {
        throw new Error('[internal] kms down')
      },
    }
    await expect(sealArtifactPayload(service, SCOPE, REF, PLAINTEXT)).rejects.toThrow('kms down')
  })

  describe('with the real TenantDataEncryptionService and the module encryption maps', () => {
    const TENANT_ID = '11111111-1111-4111-8111-111111111111'
    const ORG_ID = '22222222-2222-4222-8222-222222222222'
    const REAL_SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
    const DEK: TenantDek = { tenantId: TENANT_ID, key: Buffer.alloc(32, 7).toString('base64'), fetchedAt: Date.now() }
    const FILE_REF = { entityId: 'agent_orchestrator:agent_run_artifact', field: 'caption' }
    const originalToggle = process.env.TENANT_DATA_ENCRYPTION

    async function executeModulePolicy(_sql: string, params: unknown[]): Promise<Array<Record<string, unknown>>> {
      const entityId = params[0]
      return defaultEncryptionMaps.filter((map) => map.entityId === entityId).map((map) => ({
        entity_id: map.entityId,
        tenant_id: null,
        organization_id: null,
        fields_json: map.fields,
      }))
    }

    function realService(dek: TenantDek | null = DEK) {
      const kms: KmsService = {
        isHealthy: () => true,
        getTenantDek: async () => dek,
        createTenantDek: async () => dek,
      }
      return new TenantDataEncryptionService({ execute: executeModulePolicy } as never, { kms })
    }

    function storageWith(service: TenantDataEncryptionService) {
      const blobs = new Map<string, Buffer>()
      let seq = 0
      const storage = {
        upload: async ({ buffer }: { buffer: Buffer }) => {
          const key = `k-${++seq}`
          blobs.set(key, buffer)
          return { key }
        },
        download: async ({ key }: { key: string }) => ({ buffer: blobs.get(key)! }),
      }
      const registry: Record<string, unknown> = {
        storageService: { _resolveService: async () => storage },
        tenantEncryptionService: service,
      }
      const container = {
        hasRegistration: (name: string) => name in registry,
        resolve: <T,>(name: string) => registry[name] as T,
      }
      return { container, blobs }
    }

    beforeEach(() => {
      process.env.TENANT_DATA_ENCRYPTION = 'true'
    })

    afterEach(() => {
      if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = originalToggle
    })

    it.each([...Object.entries(ARTIFACT_REFS), ['fileBytes', FILE_REF] as const])(
      'seals the %s ref into a real AES-GCM envelope',
      async (_name, ref) => {
        const sealed = await sealArtifactPayload(realService(), REAL_SCOPE, ref, PLAINTEXT)
        expect(sealed).not.toBeNull()
        expect(JSON.stringify(sealed)).not.toContain('jane.doe@example.com')
      },
    )

    it('round-trips a trace artifact and file bytes through the stores', async () => {
      const { container, blobs } = storageWith(realService())
      const value = { prompt: 'refund order for jane.doe@example.com' }

      const key = await putArtifact(container, REAL_SCOPE, ARTIFACT_REFS.llmRequest, value)
      expect(key).not.toBeNull()
      expect(blobs.get(key!)!.toString('utf8')).not.toContain('jane.doe@example.com')
      expect(await getArtifact(container, REAL_SCOPE, ARTIFACT_REFS.llmRequest, key!)).toEqual(value)

      const bytes = Buffer.from('statement for jane.doe@example.com', 'utf8')
      const fileKey = await putArtifactBytes(container, REAL_SCOPE, { buffer: bytes, fileName: 'a.txt' })
      expect(fileKey).not.toBeNull()
      expect(await getArtifactBytes(container, REAL_SCOPE, fileKey!)).toEqual(bytes)
    })

    it('returns null and stores nothing when no DEK can be resolved', async () => {
      const keylessScope = { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: ORG_ID }
      const service = realService(null)
      expect(await sealArtifactPayload(service, keylessScope, ARTIFACT_REFS.llmRequest, PLAINTEXT)).toBeNull()
      const { container, blobs } = storageWith(service)
      expect(await putArtifact(container, keylessScope, ARTIFACT_REFS.llmRequest, { a: 1 })).toBeNull()
      expect(blobs.size).toBe(0)
    })

    it('returns null when no encryption map covers the entity', async () => {
      const ref = { entityId: 'agent_orchestrator:unmapped_entity', field: 'input' }
      expect(await sealArtifactPayload(realService(), REAL_SCOPE, ref, PLAINTEXT)).toBeNull()
    })

    it('returns the plaintext wrapper when tenant data encryption is turned off', async () => {
      process.env.TENANT_DATA_ENCRYPTION = 'false'
      expect(await sealArtifactPayload(realService(), REAL_SCOPE, ARTIFACT_REFS.llmRequest, PLAINTEXT)).toEqual({
        input: PLAINTEXT,
      })
    })

    it('stores and round-trips plaintext through both stores when encryption is turned off', async () => {
      process.env.TENANT_DATA_ENCRYPTION = 'false'
      const { container, blobs } = storageWith(realService())
      const value = { prompt: 'refund order for jane.doe@example.com' }

      const key = await putArtifact(container, REAL_SCOPE, ARTIFACT_REFS.llmRequest, value)
      expect(key).not.toBeNull()
      expect(JSON.parse(blobs.get(key!)!.toString('utf8'))).toEqual({ input: JSON.stringify(value) })
      expect(await getArtifact(container, REAL_SCOPE, ARTIFACT_REFS.llmRequest, key!)).toEqual(value)

      const bytes = Buffer.from('statement for jane.doe@example.com', 'utf8')
      const fileKey = await putArtifactBytes(container, REAL_SCOPE, { buffer: bytes, fileName: 'a.txt' })
      expect(fileKey).not.toBeNull()
      expect(await getArtifactBytes(container, REAL_SCOPE, fileKey!)).toEqual(bytes)
    })

    it('returns null when the KMS is unhealthy', async () => {
      const kms: KmsService = { isHealthy: () => false, getTenantDek: async () => DEK, createTenantDek: async () => DEK }
      const service = new TenantDataEncryptionService({ execute: executeModulePolicy } as never, { kms })
      expect(await sealArtifactPayload(service, REAL_SCOPE, ARTIFACT_REFS.llmRequest, PLAINTEXT)).toBeNull()
    })
  })
})
