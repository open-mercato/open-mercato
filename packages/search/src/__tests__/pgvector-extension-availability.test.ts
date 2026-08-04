import { createPgVectorDriver, type PgPool } from '../vector/drivers/pgvector'
import { VectorSearchStrategy } from '../strategies/vector.strategy'
import { SearchService } from '../service'
import type { IndexableRecord } from '../types'

type QueryCall = { text: string; params?: unknown[] }

function pgError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function createPool(options: {
  extensionInstalled?: boolean
  extensionInstallable?: boolean
  calls: QueryCall[]
}): PgPool {
  const { calls } = options
  const run = async (text: string, params?: unknown[]) => {
    calls.push({ text, params })
    if (/pg_available_extensions/.test(text)) {
      return {
        rows: [{
          installed: options.extensionInstalled ?? false,
          installable: options.extensionInstallable ?? false,
        }],
      }
    }
    if (/CREATE EXTENSION IF NOT EXISTS vector/.test(text)) {
      if (options.extensionInstalled || options.extensionInstallable) return { rows: [] }
      throw pgError('58P01', 'extension "vector" is not available')
    }
    return { rows: [] }
  }
  return {
    connect: async () => ({ query: run as PgPool['query'], release: () => {} }),
    query: run as PgPool['query'],
    end: async () => {},
  }
}

describe('pgvector extension availability', () => {
  it('reports the driver unhealthy when the extension cannot be installed', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool({ calls }) })

    expect(await driver.isHealthy!()).toBe(false)
    const status = await driver.getStatus!()
    expect(status.available).toBe(false)
    expect(status.reason).toMatch(/vector/)
  })

  it('probes the catalog once instead of running DDL for every record', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool({ calls }) })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await driver.isHealthy!()).toBe(false)
    }

    const probes = calls.filter((call) => /pg_available_extensions/.test(call.text))
    expect(probes).toHaveLength(1)
    expect(calls.some((call) => /CREATE TABLE/.test(call.text))).toBe(false)
  })

  it('short-circuits ensureReady once the extension is known to be missing', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool({ calls }) })

    await expect(driver.ensureReady()).rejects.toThrow(/vector/)
    const afterFirst = calls.length
    await expect(driver.ensureReady()).rejects.toThrow(/vector/)

    expect(calls.length).toBe(afterFirst)
  })

  it('stays healthy when the extension is installable', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool({ calls, extensionInstallable: true }) })

    expect(await driver.isHealthy!()).toBe(true)
    await expect(driver.ensureReady()).resolves.toBeUndefined()
  })

  it('keeps the existing superuser-less degradation path', async () => {
    const calls: QueryCall[] = []
    const pool = createPool({ calls, extensionInstalled: true })
    const originalQuery = pool.query
    pool.query = (async (text: string, params?: unknown[]) => {
      if (/CREATE EXTENSION IF NOT EXISTS vector/.test(text)) {
        calls.push({ text, params })
        throw pgError('42501', 'permission denied to create extension "vector"')
      }
      return originalQuery(text, params)
    }) as PgPool['query']
    pool.connect = async () => ({ query: pool.query as never, release: () => {} })

    const driver = createPgVectorDriver({ pool })
    await expect(driver.ensureReady()).resolves.toBeUndefined()
    expect(await driver.isHealthy!()).toBe(true)
  })
})

describe('vector strategy availability', () => {
  const embeddingService = { available: true, createEmbedding: jest.fn() }

  function createDriver(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'pgvector' as const,
      ensureReady: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      getChecksum: jest.fn().mockResolvedValue(null),
      ...overrides,
    }
  }

  it('is unavailable when the store reports itself unhealthy', async () => {
    const driver = createDriver({ isHealthy: jest.fn().mockResolvedValue(false) })
    const strategy = new VectorSearchStrategy(embeddingService, driver)

    expect(await strategy.isAvailable()).toBe(false)
  })

  it('stays available for drivers that expose no probe', async () => {
    const strategy = new VectorSearchStrategy(embeddingService, createDriver())

    expect(await strategy.isAvailable()).toBe(true)
  })

  it('never touches the store on delete when it is unhealthy', async () => {
    const driver = createDriver({ isHealthy: jest.fn().mockResolvedValue(false) })
    const strategy = new VectorSearchStrategy(embeddingService, driver)
    const service = new SearchService({ strategies: [strategy] })

    await expect(service.delete('customers:customer_deal', 'rec-1', 'tenant-1')).resolves.toBeUndefined()
    expect(driver.ensureReady).not.toHaveBeenCalled()
    expect(driver.delete).not.toHaveBeenCalled()
  })

  it('never touches the store on index when it is unhealthy', async () => {
    const driver = createDriver({ isHealthy: jest.fn().mockResolvedValue(false) })
    const strategy = new VectorSearchStrategy(embeddingService, driver)
    const service = new SearchService({ strategies: [strategy] })
    const record: IndexableRecord = {
      entityId: 'customers:customer_deal',
      recordId: 'rec-1',
      tenantId: 'tenant-1',
      fields: { name: 'Deal' },
      text: 'Deal',
    }

    await expect(service.index(record)).resolves.toBeUndefined()
    expect(driver.ensureReady).not.toHaveBeenCalled()
    expect(driver.upsert).not.toHaveBeenCalled()
  })
})
