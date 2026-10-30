import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { retireScopedCatalogueRows } from '@open-mercato/core/modules/query_index/lib/stale'
import { deleteScopedCoverageForEntity } from '@open-mercato/core/modules/query_index/lib/coverage'
import { replaceSearchTokensForRecord } from '@open-mercato/core/modules/query_index/lib/search-tokens'
import { resetTenantGlobalEntityTypes } from '@open-mercato/core/modules/query_index/lib/tenant-global'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'
import { SearchService } from '../service'
import { SearchIndexer } from '../indexer/search-indexer'
import { TokenSearchStrategy } from '../strategies/token.strategy'
import { VectorSearchStrategy } from '../strategies/vector.strategy'
import { createPgVectorDriver } from '../vector/drivers/pgvector'
import { handleVectorIndexJob } from '../modules/search/workers/vector-index.worker'
import type { SearchOptions, SearchIndexDocFilter } from '../types'

jest.mock('../modules/search/lib/auto-indexing', () => ({ resolveAutoIndexingEnabled: async () => true }))
jest.mock('../modules/search/lib/embedding-config', () => ({ resolveEmbeddingConfig: async () => null }))
jest.mock('../vector/lib/vector-logs', () => ({ logVectorOperation: async () => undefined }))

const PG_URL = process.env.OM_QUERY_INDEX_PG_URL
const CATALOGUE = 'feature_toggles:feature_toggle'
const PRIVATE = 'private:catalogue'
const ORDINARY = 'customers:customer_person_profile'
const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '44444444-4444-4444-8444-444444444444'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '33333333-3333-4333-8333-333333333333'
const RECORD = '55555555-5555-4555-8555-555555555555'
const TERM = 'zephyrcatalogue'
type Scope = { entity_type: string; entity_id: string; tenant_id: string | null; organization_id: string | null }
type PipelineDatabase = {
  entity_indexes: Scope & { doc: Record<string, unknown>; deleted_at: Date | null }
  search_tokens: Scope & { field: string; token_hash: string; token: string | null }
  entity_index_coverage: { entity_type: string; tenant_id: string | null; organization_id: string | null }
}

const describePostgres = PG_URL ? describe : describe.skip

describePostgres('catalogue worker and hybrid search against PostgreSQL', () => {
  let db: Kysely<PipelineDatabase>
  let pool: Pool
  let service: SearchService
  const doc = { id: RECORD, name: TERM, active: true }

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL })
    db = new Kysely<PipelineDatabase>({ dialect: new PostgresDialect({ pool }) })
    await sql`create table entity_indexes (
      entity_type text, entity_id text, tenant_id uuid, organization_id uuid,
      doc jsonb, deleted_at timestamptz
    )`.execute(db)
    await sql`create table search_tokens (
      entity_type text, entity_id text, tenant_id uuid, organization_id uuid,
      field text, token_hash text, token text, created_at timestamptz
    )`.execute(db)
    await sql`create table entity_index_coverage (
      entity_type text, tenant_id uuid, organization_id uuid
    )`.execute(db)
    const driver = createPgVectorDriver({ pool, dimension: 3 })
    const embedding = { available: true, createEmbedding: async () => [1, 0, 0] }
    service = new SearchService({ strategies: [new TokenSearchStrategy(db), new VectorSearchStrategy(embedding, driver)] })
    await driver.ensureReady()
  })

  afterAll(async () => {
    resetTenantGlobalEntityTypes()
    if (db) {
      await sql`drop table if exists search_tokens, entity_indexes, entity_index_coverage, vector_search, vector_search_migrations`.execute(db)
      await db.destroy()
    }
  })

  beforeEach(async () => {
    resetTenantGlobalEntityTypes()
    await sql`truncate search_tokens, entity_indexes, entity_index_coverage, vector_search`.execute(db)
  })

  async function projection(entityType: string, tenantId: string | null, organizationId: string | null) {
    await db.insertInto('entity_indexes').values({
      entity_type: entityType, entity_id: RECORD, tenant_id: tenantId, organization_id: organizationId,
      doc, deleted_at: null,
    }).execute()
  }

  async function runWorker(entityType = CATALOGUE) {
    const queryEngine: QueryEngine = {
      query: async () => ({ items: [doc], total: 1 } as QueryResult),
    }
    const searchIndexer = new SearchIndexer(service, [{ entities: [{
      entityId: entityType,
      buildSource: async () => ({ text: TERM, checksumSource: doc, presenter: { title: TERM } }),
    }] }], { queryEngine })
    await handleVectorIndexJob({
      id: 'catalogue-worker', createdAt: new Date().toISOString(),
      payload: { jobType: 'index', entityType, recordId: RECORD, tenantId: TENANT, organizationId: ORG },
    }, { jobId: 'catalogue-worker', attemptNumber: 1, queueName: 'vector-indexing' }, {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'searchIndexer') return searchIndexer as T
        if (name === 'eventBus') return { emitEvent: async () => undefined } as T
        throw new Error(`[internal] Test service unavailable: ${name}`)
      },
    })
  }

  async function search(strategies: string[], indexDocFilter?: SearchIndexDocFilter, overrides: Partial<SearchOptions> = {}) {
    return service.search(TERM, { tenantId: TENANT, organizationId: ORG, strategies, indexDocFilter, ...overrides })
  }

  it('keeps one canonical token scope after retirement and the real worker, then fuses token and caller-scoped vector hits', async () => {
    await projection(CATALOGUE, null, null)
    await projection(CATALOGUE, TENANT, ORG)
    for (const scope of [{ tenantId: null, organizationId: null }, { tenantId: TENANT, organizationId: ORG }]) {
      await replaceSearchTokensForRecord(db, { entityType: CATALOGUE, recordId: RECORD, doc, ...scope })
    }
    await db.insertInto('entity_index_coverage').values({ entity_type: CATALOGUE, tenant_id: TENANT, organization_id: ORG }).execute()
    await retireScopedCatalogueRows(db, { entityType: CATALOGUE, partitionIndex: null, partitionCount: null })
    await deleteScopedCoverageForEntity(db, CATALOGUE)
    await runWorker()
    await runWorker()

    const scopes = await db.selectFrom('search_tokens').select(['tenant_id', 'organization_id']).distinct().execute()
    expect(scopes).toEqual([{ tenant_id: null, organization_id: null }])
    expect(await db.selectFrom('entity_index_coverage').selectAll().execute()).toEqual([])
    expect(await search(['tokens'])).toHaveLength(1)
    const hybrid = await search(['tokens', 'vector'])
    expect(hybrid).toHaveLength(1)
    expect(hybrid[0]).toMatchObject({ entityId: CATALOGUE, recordId: RECORD, organizationId: null, presenter: { title: TERM } })
    expect(new Set(hybrid[0].metadata?._sources as string[])).toEqual(new Set(['tokens', 'vector']))
    const vectors = await sql<{ tenant_id: string; organization_id: string }>`select tenant_id, organization_id from vector_search`.execute(db)
    expect(vectors.rows).toEqual([{ tenant_id: TENANT, organization_id: ORG }])
    expect(await search(['tokens'], undefined, { tenantId: OTHER_TENANT, organizationId: OTHER_ORG })).toHaveLength(1)
    expect(await search(['vector'], undefined, { tenantId: OTHER_TENANT, organizationId: ORG })).toEqual([])
  })

  it('canonicalizes bulk token writes and deletes without changing ordinary scopes', async () => {
    await service.bulkIndex([CATALOGUE, ORDINARY].map((entityId) => ({
      entityId, recordId: RECORD, tenantId: TENANT, organizationId: ORG, fields: doc, text: TERM,
    })))
    const scopes = await db.selectFrom('search_tokens').select(['entity_type', 'tenant_id', 'organization_id'])
      .distinct().orderBy('entity_type').execute()
    expect(scopes).toEqual([
      { entity_type: ORDINARY, tenant_id: TENANT, organization_id: ORG },
      { entity_type: CATALOGUE, tenant_id: null, organization_id: null },
    ])
    await new TokenSearchStrategy(db).delete(CATALOGUE, RECORD, TENANT)
    expect(await db.selectFrom('search_tokens').selectAll().where('entity_type', '=', CATALOGUE).execute()).toEqual([])
    expect(await search(['tokens'], undefined, { entityTypes: [ORDINARY] })).toHaveLength(1)
  })

  it.each<SearchIndexDocFilter>([
    { anyOf: [[]] },
    { anyOf: [[{ op: 'eq', key: 'active', value: true }]] },
  ])('applies a matching document filter to canonical tokens and tenant-scoped vectors: %j', async (filter) => {
    await projection(CATALOGUE, null, null)
    await runWorker()
    for (const strategies of [['tokens'], ['vector'], ['tokens', 'vector']]) {
      const results = await search(strategies, filter)
      expect(results).toHaveLength(1)
      expect(results[0].recordId).toBe(RECORD)
    }
  })

  it('rejects nonmatching, deleted and undeclared null-tenant projections for both strategies', async () => {
    await projection(CATALOGUE, null, null)
    await runWorker()
    const nonmatching: SearchIndexDocFilter = { anyOf: [[{ op: 'eq', key: 'active', value: false }]] }
    for (const strategies of [['tokens'], ['vector'], ['tokens', 'vector']]) {
      expect(await search(strategies, nonmatching)).toEqual([])
    }
    await db.updateTable('entity_indexes').set({ deleted_at: new Date() }).execute()
    expect(await search(['tokens', 'vector'], { anyOf: [[]] })).toEqual([])
    await projection(PRIVATE, null, null)
    await runWorker(PRIVATE)
    expect(await search(['tokens', 'vector'], { anyOf: [[]] }, { entityTypes: [PRIVATE] })).toEqual([])
    expect(await search(['tokens', 'vector'], undefined, { tenantId: OTHER_TENANT, entityTypes: [PRIVATE] })).toEqual([])
  })

  it('keeps ordinary records scoped to their own tenant and organization', async () => {
    await projection(ORDINARY, TENANT, ORG)
    await runWorker(ORDINARY)
    expect(await search(['tokens', 'vector'], { anyOf: [[]] })).toHaveLength(1)
    for (const strategies of [['tokens'], ['vector'], ['tokens', 'vector']]) {
      expect(await search(strategies, undefined, { tenantId: OTHER_TENANT })).toEqual([])
      expect(await search(strategies, undefined, { organizationId: OTHER_ORG })).toEqual([])
    }
  })
})
