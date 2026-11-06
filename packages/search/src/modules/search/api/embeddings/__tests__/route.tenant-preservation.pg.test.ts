import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { MikroORM } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import { getEntityIds, registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { resolveQueryIndexSearchScope } from '@open-mercato/core/modules/query_index/lib/search-scope'
import { ModuleConfig } from '@open-mercato/core/modules/configs/data/entities'
import { createModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { createPgVectorDriver, type PgPool } from '../../../../../vector/drivers/pgvector'
import { EMBEDDING_CONFIG_KEY, type EmbeddingProviderConfig, type VectorDriver } from '../../../../../vector'
import { SEARCH_AUTO_INDEX_CONFIG_KEY } from '../../../lib/auto-indexing'

jest.mock('@open-mercato/shared/lib/db/mikro', () => ({ getOrm: jest.fn() }))

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('../../../../../lib/debug', () => ({
  searchError: jest.fn(), reportSearchError: jest.fn(), searchWarn: jest.fn(), searchDebugWarn: jest.fn(),
}))

import { POST } from '../route'

const pgUrl = process.env.OM_SEARCH_PGVECTOR_TEST_URL
const describePostgres = pgUrl ? describe : describe.skip
const originalEnv = { ...process.env }

describePostgres('embedding POST with real PostgreSQL settings and shared pgvector rows', () => {
  const schema = `issue_8676_${randomUUID().replaceAll('-', '')}`
  const tableName = `${schema}_vectors`
  const migrationsTable = `${schema}_migrations`
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const recordA = randomUUID()
  const recordB = randomUUID()
  const config: EmbeddingProviderConfig = {
    providerId: 'openai', model: 'text-embedding-3-small', dimension: 3, updatedAt: '2026-01-01T00:00:00Z',
  }
  const previousEntityIds = getEntityIds(false)
  const statements: string[] = []
  let pool: Pool
  let orm: MikroORM
  let driver: VectorDriver

  function request(tenantId: string, embeddingConfig: EmbeddingProviderConfig, autoIndexingEnabled?: boolean) {
    const em = orm.em.fork({ useContext: true })
    const resolver = {
      resolve: <T,>(name: string): T => {
        if (name === 'em') return em as T
        if (name === 'vectorDrivers') return [driver] as T
        if (name === 'moduleConfigService') return service as T
        if (name === 'vectorEmbeddingService') return { updateConfig: () => {} } as T
        throw new Error(`[internal] Unknown service ${name}`)
      },
    }
    const service = createModuleConfigService(resolver as unknown as AppContainer)
    mockGetAuthFromRequest.mockResolvedValueOnce({ sub: randomUUID(), tenantId })
    mockCreateRequestContainer.mockResolvedValueOnce(resolver)
    return POST(new Request('http://localhost/api/search/embeddings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ embeddingConfig, ...(autoIndexingEnabled !== undefined ? { autoIndexingEnabled } : {}) }),
    }))
  }

  async function storedSettings(tenantId: string) {
    const result = await pool.query<{ name: string; value_json: unknown }>(
      `SELECT name, value_json FROM "${schema}".module_configs WHERE tenant_id = $1 ORDER BY name`, [tenantId],
    )
    return result.rows
  }

  async function assertPreserved() {
    expect(await driver.count!({ tenantId: tenantA })).toBe(1)
    expect(await driver.count!({ tenantId: tenantB })).toBe(1)
    expect(await resolveQueryIndexSearchScope()).toMatchObject({ searchableEntityTypes: ['configs:module_config'] })
    const results = await driver.query({ vector: [1, 0, 0], filter: { tenantId: tenantB }, limit: 5 })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ recordId: recordB, checksum: 'tenant-b-checksum', score: 1 })
    expect((await pool.query(`SELECT id FROM "${migrationsTable}"`)).rows).toEqual([{ id: '0001_init' }])
    expect(statements.some((statement) => /\b(DROP|TRUNCATE|DELETE)\b/i.test(statement))).toBe(false)
  }

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-placeholder'
    process.env.MISTRAL_API_KEY = 'test-placeholder'
    delete process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING
    delete process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
    pool = new Pool({ connectionString: pgUrl, options: '-c enable_indexscan=off' })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    const scopedUrl = new URL(pgUrl!)
    scopedUrl.searchParams.set('options', `-csearch_path=${schema},public`)
    orm = await MikroORM.init({ entities: [ModuleConfig], clientUrl: scopedUrl.toString(), schema, allowGlobalContext: true })
    orm.getMetadata().get(ModuleConfig).schema = schema
    await pool.query(`CREATE TABLE "${schema}".module_configs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module_id text NOT NULL, name text NOT NULL,
      value_json jsonb, tenant_id uuid, organization_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (module_id, name, tenant_id)
    )`)
    registerEntityIds({ configs: { module_config: 'configs:module_config' } })
    jest.mocked(getOrm).mockResolvedValue(orm as Awaited<ReturnType<typeof getOrm>>)
    const recordingPool: PgPool = {
      query: async (text, params) => {
        statements.push(text)
        return pool.query(text, params)
      },
      connect: async () => {
        const client = await pool.connect()
        return {
          query: async (text, params) => { statements.push(text); return client.query(text, params) },
          release: () => client.release(),
        }
      },
      end: async () => {},
    }
    driver = createPgVectorDriver({ pool: recordingPool, tableName, migrationsTable, dimension: 3 })
    await driver.ensureReady()
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    await pool.query(`DELETE FROM "${tableName}"`)
    await pool.query(`DELETE FROM "${schema}".module_configs`)
    const em = orm.em.fork({ useContext: true })
    const resolver = { resolve: () => em } as unknown as AppContainer
    const service = createModuleConfigService(resolver)
    for (const tenantId of [tenantA, tenantB]) {
      await service.setValue('vector', EMBEDDING_CONFIG_KEY, config, { tenantId })
      await service.setValue('vector', SEARCH_AUTO_INDEX_CONFIG_KEY, true, { tenantId })
    }
    for (const [tenantId, recordId, checksum] of [[tenantA, recordA, 'tenant-a-checksum'], [tenantB, recordB, 'tenant-b-checksum']]) {
      await driver.upsert({ entityId: 'configs:module_config', recordId, tenantId, checksum, embedding: [1, 0, 0] })
    }
    statements.length = 0
    await assertPreserved()
    statements.length = 0
  })

  afterAll(async () => {
    process.env = originalEnv
    registerEntityIds(previousEntityIds)
    await orm?.close(true)
    if (pool) {
      await pool.query(`DROP TABLE IF EXISTS "${tableName}", "${migrationsTable}"`)
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
  })

  it.each([
    ['model', { ...config, model: 'text-embedding-ada-002' }],
    ['provider', { ...config, providerId: 'mistral' as const, model: 'mistral-embed' }],
    ['effective dimension', { ...config, dimension: 3072, outputDimensionality: 3 }],
  ])('keeps tenant B searchable when tenant A changes %s at the same dimension', async (_description, nextConfig) => {
    const beforeB = await storedSettings(tenantB)
    const response = await request(tenantA, nextConfig)
    expect(response.status).toBe(200)
    expect((await response.json()).settings).toMatchObject({ indexedDimension: 3, reindexRequired: _description !== 'effective dimension' })
    expect(await storedSettings(tenantB)).toEqual(beforeB)
    expect((await storedSettings(tenantA)).find((row) => row.name === EMBEDDING_CONFIG_KEY)?.value_json).toMatchObject({ ...nextConfig, updatedAt: expect.any(String) })
    await assertPreserved()
  })

  it('rejects an incompatible dimension without saving any settings', async () => {
    const beforeA = await storedSettings(tenantA)
    expect((await request(tenantA, { ...config, dimension: 4 }, false)).status).toBe(409)
    expect(await storedSettings(tenantA)).toEqual(beforeA)
    await assertPreserved()
  })

  it('rolls back a saved embedding config when the companion flag write fails', async () => {
    const beforeA = await storedSettings(tenantA)
    await pool.query(`ALTER TABLE "${schema}".module_configs ADD CONSTRAINT reject_flag CHECK (name <> '${SEARCH_AUTO_INDEX_CONFIG_KEY}' OR value_json::text <> 'false')`)
    try {
      const response = await request(tenantA, { ...config, model: 'text-embedding-ada-002' }, false)
      expect(response.status).toBe(500)
      expect(await storedSettings(tenantA)).toEqual(beforeA)
      await assertPreserved()
    } finally {
      await pool.query(`ALTER TABLE "${schema}".module_configs DROP CONSTRAINT reject_flag`)
    }
  })

  it('commits concurrent compatible tenant updates independently', async () => {
    const responses = await Promise.all([
      request(tenantA, { ...config, model: 'text-embedding-ada-002' }),
      request(tenantB, { ...config, model: 'text-embedding-3-large' }),
    ])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect((await storedSettings(tenantA)).find((row) => row.name === EMBEDDING_CONFIG_KEY)?.value_json).toMatchObject({ model: 'text-embedding-ada-002' })
    expect((await storedSettings(tenantB)).find((row) => row.name === EMBEDDING_CONFIG_KEY)?.value_json).toMatchObject({ model: 'text-embedding-3-large' })
    await assertPreserved()
  })

  it('isolates a failed transaction from a concurrent successful tenant update', async () => {
    const beforeA = await storedSettings(tenantA)
    await pool.query(`ALTER TABLE "${schema}".module_configs ADD CONSTRAINT reject_flag CHECK (name <> '${SEARCH_AUTO_INDEX_CONFIG_KEY}' OR value_json::text <> 'false')`)
    try {
      const responses = await Promise.all([
        request(tenantA, { ...config, model: 'text-embedding-ada-002' }, false),
        request(tenantB, { ...config, model: 'text-embedding-3-large' }),
      ])
      expect(responses.map((response) => response.status)).toEqual([500, 200])
      expect(await storedSettings(tenantA)).toEqual(beforeA)
      expect((await storedSettings(tenantB)).find((row) => row.name === EMBEDDING_CONFIG_KEY)?.value_json).toMatchObject({ model: 'text-embedding-3-large' })
      await assertPreserved()
    } finally {
      await pool.query(`ALTER TABLE "${schema}".module_configs DROP CONSTRAINT reject_flag`)
    }
  })

  it('preserves both tenants under concurrent compatible and incompatible updates', async () => {
    const beforeB = await storedSettings(tenantB)
    const responses = await Promise.all([
      request(tenantA, { ...config, model: 'text-embedding-ada-002' }),
      request(tenantB, { ...config, dimension: 4 }),
    ])
    expect(responses.map((response) => response.status)).toEqual([200, 409])
    expect(await storedSettings(tenantB)).toEqual(beforeB)
    await assertPreserved()
  })
})
