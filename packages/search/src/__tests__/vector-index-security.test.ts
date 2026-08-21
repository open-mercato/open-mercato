import { VectorIndexService } from '../vector/services/vector-index.service'
import type { EmbeddingService } from '../vector/services/embedding'
import type { VectorDriver, VectorDriverDocument } from '../vector/types'
import type { VectorModuleConfig } from '@open-mercato/shared/modules/vector'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

type CapturedEmbeddingInput = { value: string | string[] | null }

function createEmbeddingService(captured: CapturedEmbeddingInput): EmbeddingService {
  return {
    available: true,
    createEmbedding: async (input: string | string[]) => {
      captured.value = input
      return [0.1, 0.2, 0.3]
    },
  } as unknown as EmbeddingService
}

function createDriver(overrides: Partial<VectorDriver> = {}): VectorDriver & { upsertCalls: VectorDriverDocument[] } {
  const upsertCalls: VectorDriverDocument[] = []
  const driver = {
    id: 'pgvector' as const,
    ensureReady: async () => {},
    upsert: async (doc: VectorDriverDocument) => {
      upsertCalls.push(doc)
    },
    delete: async () => {},
    query: async () => [],
    getChecksum: async () => null,
    list: async () => [],
    upsertCalls,
    ...overrides,
  }
  return driver as VectorDriver & { upsertCalls: VectorDriverDocument[] }
}

function createQueryEngine(record: Record<string, unknown>): QueryEngine {
  return {
    query: async () => ({ items: [record], total: 1 }),
  } as unknown as QueryEngine
}

function createService(args: {
  driver: VectorDriver
  embeddingService: EmbeddingService
  queryEngine: QueryEngine
  moduleConfigs: VectorModuleConfig[]
  encryptionService?: TenantDataEncryptionService | null
}): VectorIndexService {
  return new VectorIndexService({
    drivers: [args.driver],
    embeddingService: args.embeddingService,
    queryEngine: args.queryEngine,
    moduleConfigs: args.moduleConfigs,
    containerResolver: () => ({
      resolve: (name: string) => {
        if (name === 'tenantEncryptionService') {
          if (!args.encryptionService) throw new Error('not registered')
          return args.encryptionService
        }
        throw new Error(`unexpected resolve: ${name}`)
      },
    }),
  })
}

describe('VectorIndexService default source field protection (issue #2716)', () => {
  it('excludes snake_case scope and timestamp fields from the default embedding source', async () => {
    const captured: CapturedEmbeddingInput = { value: null }
    const record = {
      id: 'rec-1',
      tenant_id: 'tenant-secret',
      organization_id: 'org-secret',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      deleted_at: null,
      name: 'Visible Name',
      description: 'Visible Description',
    }
    const service = createService({
      driver: createDriver(),
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine(record),
      moduleConfigs: [{ entities: [{ entityId: 'demo:item' }] }],
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'rec-1', tenantId: 'tenant-secret' })

    const lines = Array.isArray(captured.value) ? captured.value.join('\n') : String(captured.value)
    expect(lines).toContain('name: Visible Name')
    expect(lines).toContain('description: Visible Description')
    expect(lines).not.toContain('tenant-secret')
    expect(lines).not.toContain('org-secret')
    expect(lines).not.toContain('tenant_id')
    expect(lines).not.toContain('organization_id')
    expect(lines).not.toContain('created_at')
    expect(lines).not.toContain('updated_at')
  })

  it('honors fieldPolicy.excluded/hashOnly and the searchable allowlist for record and custom fields', async () => {
    const captured: CapturedEmbeddingInput = { value: null }
    const record = {
      id: 'rec-2',
      tenant_id: 'tenant-1',
      name: 'Allowed Name',
      ssn: '123-45-6789',
      email: 'person@example.com',
      'cf:notes': 'Allowed note',
      'cf:secret_token': 'sk-should-not-leak',
    }
    const service = createService({
      driver: createDriver(),
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine(record),
      moduleConfigs: [
        {
          entities: [
            {
              entityId: 'demo:item',
              fieldPolicy: {
                searchable: ['name', 'notes'],
                hashOnly: ['email'],
                excluded: ['ssn', 'secret_token'],
              },
            },
          ],
        },
      ],
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'rec-2', tenantId: 'tenant-1' })

    const lines = Array.isArray(captured.value) ? captured.value.join('\n') : String(captured.value)
    expect(lines).toContain('name: Allowed Name')
    expect(lines).toContain('custom.notes: Allowed note')
    expect(lines).not.toContain('123-45-6789')
    expect(lines).not.toContain('person@example.com')
    expect(lines).not.toContain('sk-should-not-leak')
  })
})

describe('VectorIndexService encryption fail-closed (issue #2716)', () => {
  const enabledEncryptionThatThrows = (): TenantDataEncryptionService =>
    ({
      isEnabled: () => true,
      encryptEntityPayload: async () => {
        throw new Error('KMS outage')
      },
      decryptEntityPayload: async () => {
        throw new Error('KMS outage')
      },
    }) as unknown as TenantDataEncryptionService

  it('does not persist plaintext when encryption is enabled but encryption throws', async () => {
    const driver = createDriver()
    const captured: CapturedEmbeddingInput = { value: null }
    const record = { id: 'rec-3', tenant_id: 'tenant-1', name: 'Sensitive Title' }
    const service = createService({
      driver,
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine(record),
      moduleConfigs: [{ entities: [{ entityId: 'demo:item' }] }],
      encryptionService: enabledEncryptionThatThrows(),
    })

    await expect(
      service.indexRecord({ entityId: 'demo:item', recordId: 'rec-3', tenantId: 'tenant-1' }),
    ).rejects.toThrow('KMS outage')
    expect(driver.upsertCalls).toHaveLength(0)
  })

  it('fails closed on decrypt when encryption is enabled but decryption throws', async () => {
    const driver = createDriver({
      query: async () => [
        {
          entityId: 'demo:item',
          recordId: 'rec-4',
          organizationId: null,
          score: 0.9,
          checksum: 'abc',
          resultTitle: 'cipher-title',
          resultSubtitle: null,
          resultIcon: null,
          resultBadge: null,
          resultSnapshot: null,
          primaryLinkHref: null,
          primaryLinkLabel: null,
          links: null,
          payload: null,
        },
      ],
    })
    const captured: CapturedEmbeddingInput = { value: null }
    const service = createService({
      driver,
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine({ id: 'rec-4' }),
      moduleConfigs: [{ entities: [{ entityId: 'demo:item' }] }],
      encryptionService: enabledEncryptionThatThrows(),
    })

    await expect(
      service.search({ tenantId: 'tenant-1', query: 'anything' }),
    ).rejects.toThrow('KMS outage')
  })

  it('falls back to plaintext when encryption is explicitly disabled', async () => {
    const driver = createDriver()
    const captured: CapturedEmbeddingInput = { value: null }
    const record = { id: 'rec-5', tenant_id: 'tenant-1', name: 'Title' }
    const disabledEncryption = {
      isEnabled: () => false,
      encryptEntityPayload: async () => {
        throw new Error('should not be called when disabled')
      },
    } as unknown as TenantDataEncryptionService
    const service = createService({
      driver,
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine(record),
      moduleConfigs: [{ entities: [{ entityId: 'demo:item' }] }],
      encryptionService: disabledEncryption,
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'rec-5', tenantId: 'tenant-1' })
    expect(driver.upsertCalls).toHaveLength(1)
    expect(driver.upsertCalls[0].resultTitle).toBe('Title')
  })
})
