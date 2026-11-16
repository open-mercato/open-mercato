import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine, clearColumnExistsCache } from '@open-mercato/shared/lib/query/engine'
import { HybridQueryEngine, clearBaseTableExistsCache } from '../lib/engine'

const databaseUrl = process.env.OM_COUNT_CAP_PG_URL
const describeWithPostgres = databaseUrl ? describe : describe.skip
const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const organization = '33333333-3333-4333-8333-333333333333'

describeWithPostgres('query scope against PostgreSQL (#9106)', () => {
  const createdTables: string[] = []
  let database: Kysely<Record<string, Record<string, unknown>>>
  const scopedMetadata = { className: 'ScopeProbe', tableName: 'om_scope_probes', properties: { tenantId: { name: 'tenantId', fieldNames: ['tenant_id'] }, organizationId: { name: 'organizationId', fieldNames: ['organization_id'] } } }
  const globalMetadata = { className: 'GlobalProbe', tableName: 'om_global_probes', properties: {} }
  const entityManager = {
    getKysely: () => database,
    getMetadata: () => ({ getAll: () => [scopedMetadata, globalMetadata], find: (name: string) => [scopedMetadata, globalMetadata].find((metadata) => metadata.className === name) }),
    findOne: async () => null,
  } as unknown as EntityManager

  beforeAll(async () => {
    database = new Kysely({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: databaseUrl }) }) })
    await sql`create table om_scope_probes (id text primary key, tenant_id uuid, organization_id uuid, title text)`.execute(database)
    createdTables.push('om_scope_probes')
    await sql`create table om_global_probes (id text primary key, title text)`.execute(database)
    createdTables.push('om_global_probes')
    await sql`create table entity_indexes (id text, entity_type text, entity_id text, tenant_id uuid, organization_id uuid, deleted_at timestamptz, doc jsonb)`.execute(database)
    createdTables.push('entity_indexes')
    await sql`create table custom_field_defs (id text, entity_id text, tenant_id uuid, organization_id uuid, deleted_at timestamptz, is_active boolean, key text, kind text, config_json jsonb)`.execute(database)
    createdTables.push('custom_field_defs')
    await sql`insert into om_scope_probes values ('own', ${tenantA}::uuid, ${organization}::uuid, 'Own label'), ('foreign', ${tenantB}::uuid, ${organization}::uuid, 'Foreign label')`.execute(database)
    await sql`insert into om_global_probes values ('global', 'Global label')`.execute(database)
    clearColumnExistsCache()
    clearBaseTableExistsCache()
  })

  afterAll(async () => {
    if (!database) return
    for (const table of createdTables.reverse()) await database.schema.dropTable(table).ifExists().execute()
    await database.destroy()
  })

  it.each(['basic', 'hybrid'] as const)('%s rejects an implicitly global read', async (kind) => {
    const engine = kind === 'basic' ? new BasicQueryEngine(entityManager) : new HybridQueryEngine(entityManager, new BasicQueryEngine(entityManager))
    await expect(engine.query('scope:global_probe', { tenantId: tenantA, fields: ['id', 'title'] })).rejects.toThrow('unscoped base table requires explicit scope opt-out')
  })

  it.each(['basic', 'hybrid'] as const)('%s supports a deliberate global read', async (kind) => {
    const engine = kind === 'basic' ? new BasicQueryEngine(entityManager) : new HybridQueryEngine(entityManager, new BasicQueryEngine(entityManager))
    const result = await engine.query('scope:global_probe', { tenantId: tenantA, omitAutomaticTenantOrgScope: true, fields: ['id', 'title'], decryptEncryptedFields: false })
    expect(result.items).toEqual([expect.objectContaining({ id: 'global', title: 'Global label' })])
  })

  it.each(['basic', 'hybrid'] as const)('%s keeps a foreign tenant out of relation label results', async (kind) => {
    const engine = kind === 'basic' ? new BasicQueryEngine(entityManager) : new HybridQueryEngine(entityManager, new BasicQueryEngine(entityManager))
    const result = await engine.query('scope:scope_probe', { tenantId: tenantA, organizationId: organization, fields: ['id', 'title'], decryptEncryptedFields: false })
    expect(result.items).toEqual([expect.objectContaining({ id: 'own', title: 'Own label' })])
  })
})
