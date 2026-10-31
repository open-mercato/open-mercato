import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { retireScopedCatalogueRows } from '@open-mercato/core/modules/query_index/lib/stale'
import { deleteScopedCoverageForEntity } from '@open-mercato/core/modules/query_index/lib/coverage'
import { replaceSearchTokensForRecord } from '@open-mercato/core/modules/query_index/lib/search-tokens'
import { registerTenantGlobalEntityTypes, resetTenantGlobalEntityTypes } from '@open-mercato/core/modules/query_index/lib/tenant-global'
import { getEntityIds, registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'
import { SearchService } from '../service'
import { createPresenterEnricher } from '../lib/presenter-enricher'
import { SearchIndexer } from '../indexer/search-indexer'
import { TokenSearchStrategy } from '../strategies/token.strategy'
import { VectorSearchStrategy } from '../strategies/vector.strategy'
import { createPgVectorDriver } from '../vector/drivers/pgvector'
import { handleVectorIndexJob } from '../modules/search/workers/vector-index.worker'
import type { SearchOptions, SearchIndexDocFilter } from '../types'

jest.mock('@open-mercato/shared/lib/db/mikro', () => ({ getOrm: jest.fn() }))

jest.mock('../modules/search/lib/auto-indexing', () => ({ resolveAutoIndexingEnabled: async () => true }))
jest.mock('../modules/search/lib/embedding-config', () => ({ resolveEmbeddingConfig: async () => null }))
jest.mock('../vector/lib/vector-logs', () => ({ logVectorOperation: async () => undefined }))

const PG_URL = process.env.OM_QUERY_INDEX_PG_URL
const CATALOGUE = 'feature_toggles:feature_toggle'
const PRIVATE = 'private:catalogue'
const ORDINARY = 'customers:customer_person_profile'
const ORGANIZATION = 'organizations:organization_record'
const CUSTOM = 'custom:external_note'
const fixtureEntityIds = {
  feature_toggles: { feature_toggle: CATALOGUE }, private: { catalogue: PRIVATE },
  customers: { customer_person_profile: ORDINARY }, organizations: { organization_record: ORGANIZATION },
}
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
  custom_entities_storage: { entity_type: string; entity_id: string; tenant_id: string | null; organization_id: string | null }
}

const describePostgres = PG_URL ? describe : describe.skip

describePostgres('catalogue worker and hybrid search against PostgreSQL', () => {
  let db: Kysely<PipelineDatabase>
  let pool: Pool
  let service: SearchService
  const doc = { id: RECORD, name: TERM, active: true }
  const previousEntityIds = getEntityIds(false)

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
    await sql`create table catalogue_source (id uuid, name text)`.execute(db)
    await sql`create table private_source (id uuid, secret text)`.execute(db)
    await sql`create table scoped_source (id uuid, tenant_id uuid, organization_id uuid)`.execute(db)
    await sql`create table organization_source (id uuid, organization_id uuid)`.execute(db)
    await sql`create table custom_entities_storage (entity_type text, entity_id text, tenant_id uuid, organization_id uuid)`.execute(db)
    registerEntityIds(fixtureEntityIds)
    const metadata = [
      { className: 'CustomEntityStorage', tableName: 'custom_entities_storage', properties: { tenantId: { fieldNames: ['tenant_id'] } } },
      { className: 'FeatureToggle', tableName: 'catalogue_source', properties: {} },
      { className: 'Catalogue', tableName: 'private_source', properties: {} },
      { className: 'CustomerPersonProfile', tableName: 'scoped_source', properties: { tenantId: { fieldNames: ['tenant_id'] }, organizationId: { fieldNames: ['organization_id'] } } },
      { className: 'OrganizationRecord', tableName: 'organization_source', properties: { organizationId: { fieldNames: ['organization_id'] } } },
    ]
    const registry = { find: (className: string) => metadata.find((entry) => entry.className === className), getAll: () => new Map(metadata.map((entry) => [entry.className, entry])) }
    const driverIdentity = {}
    const manager = { getMetadata: () => registry, getDriver: () => driverIdentity, getKysely: () => db } as unknown as EntityManager
    jest.mocked(getOrm).mockResolvedValue({ em: manager } as unknown as Awaited<ReturnType<typeof getOrm>>)
    const driver = createPgVectorDriver({ pool, dimension: 3 })
    const embedding = { available: true, createEmbedding: async () => [1, 0, 0] }
    service = new SearchService({ strategies: [new TokenSearchStrategy(db), new VectorSearchStrategy(embedding, driver)] })
    await driver.ensureReady()
  })

  afterAll(async () => {
    resetTenantGlobalEntityTypes()
    registerEntityIds(previousEntityIds)
    if (db) {
      await sql`drop table if exists search_tokens, entity_indexes, entity_index_coverage, vector_search, vector_search_migrations, custom_entities_storage, catalogue_source, private_source, scoped_source, organization_source`.execute(db)
      await db.destroy()
    }
  })

  beforeEach(async () => {
    resetTenantGlobalEntityTypes()
    registerEntityIds(fixtureEntityIds)
    await sql`truncate search_tokens, entity_indexes, entity_index_coverage, vector_search, custom_entities_storage`.execute(db)
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

  it('automatically quarantines legacy tenant-stamped private artifacts without operator cleanup', async () => {
    await projection(PRIVATE, TENANT, ORG)
    await replaceSearchTokensForRecord(db, { entityType: PRIVATE, recordId: RECORD, tenantId: TENANT, organizationId: ORG, doc })
    expect(await db.selectFrom('search_tokens').selectAll().where('entity_type', '=', PRIVATE).execute()).not.toHaveLength(0)
    const strategy = new TokenSearchStrategy(db)
    expect(await strategy.search(TERM, { tenantId: TENANT, organizationId: ORG, entityTypes: [PRIVATE] })).toEqual([])
    expect(await search(['tokens', 'vector'], undefined, { entityTypes: [PRIVATE] })).toEqual([])
    await projection(CATALOGUE, null, null)
    await runWorker()
    expect(await search(['tokens'])).toHaveLength(1)
    expect(await db.selectFrom('entity_indexes').selectAll().where('entity_type', '=', PRIVATE).execute()).toHaveLength(1)
  })

  it('keeps legacy private artifacts quarantined after their module and ORM metadata disappear', async () => {
    await projection(PRIVATE, TENANT, ORG)
    await replaceSearchTokensForRecord(db, { entityType: PRIVATE, recordId: RECORD, tenantId: TENANT, organizationId: ORG, doc })
    await runWorker(PRIVATE)
    const original = await getOrm()
    const registry = original.em.getMetadata()
    const metadata = [...registry.getAll().values()].filter((entry) => entry.className !== 'Catalogue')
    const manager = {
      getKysely: () => db, getDriver: () => ({}),
      getMetadata: () => ({ getAll: () => new Map(metadata.map((entry) => [entry.className, entry])), find: (name: string) => metadata.find((entry) => entry.className === name) }),
    } as unknown as EntityManager
    registerEntityIds({ ...fixtureEntityIds, private: {} })
    jest.mocked(getOrm).mockResolvedValue({ em: manager } as unknown as Awaited<ReturnType<typeof getOrm>>)
    try {
      expect(await new TokenSearchStrategy(db).search(TERM, { tenantId: TENANT, organizationId: ORG, entityTypes: [PRIVATE] })).toEqual([])
      expect(await search(['tokens', 'vector'], undefined, { entityTypes: [PRIVATE] })).toEqual([])
      const remote = new SearchService({ strategies: [{
        id: 'fulltext', name: 'Legacy remote fulltext', priority: 1, isAvailable: async () => true,
        ensureReady: async () => undefined, index: async () => undefined, delete: async () => undefined,
        search: async () => [{ entityId: PRIVATE, recordId: RECORD, source: 'fulltext', score: 1, organizationId: ORG, presenter: { title: TERM } }],
      }], defaultStrategies: ['fulltext'] })
      expect(await remote.search(TERM, { tenantId: TENANT, organizationId: ORG })).toEqual([])
      const enrich = createPresenterEnricher(db, new Map())
      expect(await enrich([{ entityId: PRIVATE, recordId: RECORD, source: 'fulltext', score: 1, presenter: { title: TERM } }], TENANT, ORG)).toEqual([])
    } finally {
      jest.mocked(getOrm).mockResolvedValue(original)
      registerEntityIds(fixtureEntityIds)
    }
  })

  it('requires exact tenant/type/record custom-storage proof before local token ranking', async () => {
    await db.insertInto('custom_entities_storage').values({ entity_type: CUSTOM, entity_id: RECORD, tenant_id: TENANT, organization_id: ORG }).execute()
    await projection(CUSTOM, TENANT, ORG)
    const strategy = new TokenSearchStrategy(db)
    await strategy.index({ entityId: CUSTOM, recordId: RECORD, tenantId: TENANT, organizationId: ORG, fields: doc })
    await replaceSearchTokensForRecord(db, { entityType: CUSTOM, recordId: '66666666-6666-4666-8666-666666666666', tenantId: TENANT, organizationId: ORG, doc })
    await replaceSearchTokensForRecord(db, { entityType: CUSTOM, recordId: RECORD, tenantId: OTHER_TENANT, organizationId: ORG, doc })
    const results = await strategy.search(TERM, { tenantId: TENANT, organizationId: ORG, entityTypes: [CUSTOM], limit: 1 })
    expect(results.map((result) => result.recordId)).toEqual([RECORD])
    const enrich = createPresenterEnricher(db, new Map())
    expect(await enrich(results, TENANT, ORG)).toHaveLength(1)
    expect(await strategy.search(TERM, { tenantId: OTHER_TENANT, organizationId: ORG, entityTypes: [CUSTOM] })).toEqual([])
    await strategy.bulkIndex([
      { entityId: CUSTOM, recordId: RECORD, tenantId: TENANT, organizationId: ORG, fields: doc },
      { entityId: 'provider:unverified', recordId: RECORD, tenantId: TENANT, organizationId: ORG, fields: doc },
    ])
    expect(await db.selectFrom('search_tokens').selectAll().where('entity_type', '=', 'provider:unverified').execute()).toEqual([])
  })

  it('rejects invalid scoped declarations through single, batch and actual worker token writes', async () => {
    registerTenantGlobalEntityTypes(ORDINARY, ORGANIZATION)
    await projection(ORDINARY, TENANT, ORG)
    await projection(ORGANIZATION, TENANT, ORG)
    await runWorker(ORDINARY)
    await runWorker(ORGANIZATION)
    const strategy = new TokenSearchStrategy(db)
    await strategy.index({ entityId: ORDINARY, recordId: RECORD, tenantId: TENANT, organizationId: ORG, fields: doc })
    await strategy.bulkIndex([ORDINARY, ORGANIZATION].map((entityId) => ({ entityId, recordId: RECORD, tenantId: TENANT, organizationId: ORG, fields: doc })))
    await strategy.index({ entityId: ORGANIZATION, recordId: RECORD, tenantId: TENANT, organizationId: ORG, fields: doc })
    const scopes = await db.selectFrom('search_tokens').select(['entity_type', 'tenant_id', 'organization_id']).distinct().execute()
    expect(scopes).toEqual([{ entity_type: ORDINARY, tenant_id: TENANT, organization_id: ORG }])
    for (const entityType of [ORDINARY, ORGANIZATION]) {
      await replaceSearchTokensForRecord(db, { entityType, recordId: RECORD, tenantId: null, organizationId: null, doc })
    }
    expect(await search(['tokens', 'vector'], undefined, { tenantId: OTHER_TENANT })).toEqual([])
    expect(await search(['tokens', 'vector'], undefined, { organizationId: OTHER_ORG })).toEqual([])
    expect(await search(['tokens'], undefined, { entityTypes: [ORDINARY] })).toHaveLength(1)
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
  it('cannot activate a scoped named-schema source using another schema table metadata', async () => {
    const original = await getOrm()
    await sql`create schema review_scoped`.execute(db)
    await sql`create table review_scoped.catalogue_source (id uuid, tenant_id uuid, organization_id uuid)`.execute(db)
    const metadata = [...original.em.getMetadata().getAll().values()].filter((entry) => entry.className !== 'FeatureToggle')
    metadata.unshift(
      {className: 'Decoy', tableName: 'catalogue_source', schema: 'public', properties: {}},
      {className: 'FeatureToggle', tableName: 'catalogue_source', schema: 'review_scoped', properties: {tenantId: {fieldNames: ['tenant_id']}, organizationId: {fieldNames: ['organization_id']}}},
    )
    const identity = {}
    const manager = {getDriver: () => identity, getKysely: () => db, getMetadata: () => ({getAll: () => new Map(metadata.map((entry) => [entry.className, entry])), find: (name: string) => metadata.find((entry) => entry.className === name)})} as unknown as EntityManager
    jest.mocked(getOrm).mockResolvedValue({em: manager} as unknown as Awaited<ReturnType<typeof getOrm>>)
    try {
      const { resolveQueryIndexSearchScope } = await import('@open-mercato/core/modules/query_index/lib/search-scope')
      const policy = await resolveQueryIndexSearchScope(manager)
      await replaceSearchTokensForRecord(db, {entityType: CATALOGUE, recordId: RECORD, tenantId: null, organizationId: null, doc})
      const hits = await new TokenSearchStrategy(db).search(TERM, {tenantId: OTHER_TENANT, organizationId: OTHER_ORG, entityTypes: [CATALOGUE]})
      expect(policy.tenantGlobalEntityTypes).not.toContain(CATALOGUE)
      expect(hits).toEqual([])
    } finally {
      jest.mocked(getOrm).mockResolvedValue(original)
      await sql`drop schema review_scoped cascade`.execute(db)
    }
  })


  it('custom-storage proof must reject another organization legacy artifact', async () => {
    await sql`alter table custom_entities_storage add column if not exists organization_id uuid`.execute(db)
    await sql`insert into custom_entities_storage (entity_type, entity_id, tenant_id, organization_id) values (${CUSTOM}, ${RECORD}, ${TENANT}::uuid, ${OTHER_ORG}::uuid)`.execute(db)
    await projection(CUSTOM, TENANT, ORG)
    await replaceSearchTokensForRecord(db, {entityType: CUSTOM, recordId: RECORD, tenantId: TENANT, organizationId: ORG, doc})
    const hits = await search(['tokens'], undefined, {entityTypes: [CUSTOM], limit: 1})
    expect(hits).toEqual([])
    const enrich = createPresenterEnricher(db, new Map())
    expect(await enrich([{ entityId: CUSTOM, recordId: RECORD, source: 'tokens', score: 1, organizationId: ORG }], TENANT, ORG)).toEqual([])
    await db.deleteFrom('search_tokens').where('entity_type', '=', CUSTOM).execute()
    const strategy = new TokenSearchStrategy(db)
    const record = { entityId: CUSTOM, recordId: RECORD, tenantId: TENANT, organizationId: ORG, fields: doc }
    await strategy.index(record)
    await strategy.bulkIndex([record])
    expect(await db.selectFrom('search_tokens').selectAll().where('entity_type', '=', CUSTOM).execute()).toEqual([])
  })
})
