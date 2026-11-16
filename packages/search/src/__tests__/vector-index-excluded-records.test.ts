import { VectorIndexService } from '../vector/services/vector-index.service'
import type { EmbeddingService } from '../vector/services/embedding'
import type { VectorDriver } from '../vector/types'
import type { VectorModuleConfig } from '@open-mercato/shared/modules/vector'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'

const ENTITY = 'demo:profile'
const TENANT = 'tenant-1'

function createService(isRecordExcluded: () => boolean | Promise<boolean>, existingChecksum: string | null) {
  const driver = {
    id: 'pgvector' as const,
    ensureReady: jest.fn(async () => undefined),
    upsert: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    query: jest.fn(async () => []),
    getChecksum: jest.fn(async () => existingChecksum),
    list: jest.fn(async () => []),
  }
  const embeddingService = {
    available: true,
    createEmbedding: jest.fn(async () => [0.1, 0.2, 0.3]),
  }
  const queryEngine = {
    query: async () => ({ items: [{ id: 'rec-1', tenant_id: TENANT, name: 'Ghost' }], total: 1 }),
  }
  const moduleConfigs: VectorModuleConfig[] = [{ entities: [{ entityId: ENTITY, isRecordExcluded }] }]
  const service = new VectorIndexService({
    drivers: [driver as unknown as VectorDriver],
    embeddingService: embeddingService as unknown as EmbeddingService,
    queryEngine: queryEngine as unknown as QueryEngine,
    moduleConfigs,
  })
  return { service, driver, embeddingService }
}

describe('VectorIndexService honours isRecordExcluded (#8638)', () => {
  it('deletes the stored vector of an excluded record instead of embedding it', async () => {
    const { service, driver, embeddingService } = createService(() => true, 'old-checksum')

    const result = await service.indexRecord({ entityId: ENTITY, recordId: 'rec-1', tenantId: TENANT })

    expect(result.action).toBe('deleted')
    expect(driver.delete).toHaveBeenCalledWith(ENTITY, 'rec-1', TENANT)
    expect(driver.upsert).not.toHaveBeenCalled()
    expect(embeddingService.createEmbedding).not.toHaveBeenCalled()
  })

  it('embeds the record when it is not excluded', async () => {
    const { service, driver } = createService(() => false, null)

    await service.indexRecord({ entityId: ENTITY, recordId: 'rec-1', tenantId: TENANT })

    expect(driver.upsert).toHaveBeenCalledTimes(1)
    expect(driver.delete).not.toHaveBeenCalled()
  })

  it('keeps embedding when the exclusion check fails', async () => {
    const { service, driver } = createService(() => { throw new Error('[internal] lookup failed') }, null)

    await service.indexRecord({ entityId: ENTITY, recordId: 'rec-1', tenantId: TENANT })

    expect(driver.upsert).toHaveBeenCalledTimes(1)
  })
})
