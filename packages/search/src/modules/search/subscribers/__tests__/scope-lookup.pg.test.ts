import { randomUUID } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { resetEntityScopeColumnsCacheForTests } from '@open-mercato/shared/lib/db/recordScope'
import vectorUpsert from '../vector_upsert'
import vectorDelete from '../vector_delete'
import fulltextUpsert from '../fulltext_upsert'

jest.mock('../../lib/auto-indexing', () => ({ resolveAutoIndexingEnabled: async () => true }))

const postgresUrl = process.env.OM_QUERY_INDEX_PG_URL
const describePostgres = postgresUrl ? describe : describe.skip
const tenantId = randomUUID()
const organizationId = randomUUID()
const otherTenantId = randomUUID()
const otherOrganizationId = randomUUID()
const recordId = randomUUID()
const otherRecordId = randomUUID()
type ScopeDatabase = Record<string, Record<string, unknown>>
type Job = {
  jobType: string
  entityType: string
  recordId: string
  tenantId: string
  organizationId: string | null
}
type Context = { resolve: <T = unknown>(name: string) => T }
type Handler = (payload: Record<string, string | null>, ctx: Context) => Promise<void>
const subscribers: Array<[string, Handler, string, string]> = [
  ['vector upsert', vectorUpsert, 'entityType', 'index'],
  ['vector delete', vectorDelete, 'entityType', 'delete'],
  ['fulltext upsert', fulltextUpsert, 'entityId', 'index'],
]

const properties = {
  id: { fieldNames: ['id'] },
  tenantId: { fieldNames: ['tenant_id'] },
  organizationId: { fieldNames: ['organization_id'] },
}
const metadata = [
  { className: 'ScopeGlobal', tableName: 'scope_global', properties: { id: properties.id } },
  { className: 'ScopeTenant', tableName: 'scope_tenant', properties: { id: properties.id, tenantId: properties.tenantId } },
  { className: 'ScopeScoped', tableName: 'scope_scoped', properties },
]

describePostgres('search subscribers resolve record scope against PostgreSQL', () => {
  const schema = `scope_lookup_${randomUUID().replaceAll('-', '')}`
  let admin: Kysely<ScopeDatabase>
  let db: Kysely<ScopeDatabase>
  const queries: string[] = []

  beforeAll(async () => {
    admin = new Kysely<ScopeDatabase>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: postgresUrl }) }) })
    await sql`create schema ${sql.id(schema)}`.execute(admin)
    db = new Kysely<ScopeDatabase>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: postgresUrl, options: `-c search_path=${schema}` }) }),
      log(event) { if (event.level === 'query') queries.push(event.query.sql) },
    })
    await sql`create table scope_global (id uuid primary key)`.execute(db)
    await sql`create table scope_tenant (id uuid primary key, tenant_id uuid not null)`.execute(db)
    await sql`create table scope_scoped (id uuid primary key, tenant_id uuid not null, organization_id uuid not null)`.execute(db)
    await sql`create table scope_probeds (id uuid primary key, tenant_id uuid not null)`.execute(db)
    await sql`insert into scope_global values (${recordId}::uuid)`.execute(db)
    for (const table of ['scope_tenant', 'scope_probeds']) {
      await sql`insert into ${sql.table(table)} values (${recordId}::uuid, ${tenantId}::uuid), (${otherRecordId}::uuid, ${otherTenantId}::uuid)`.execute(db)
    }
    await sql`insert into scope_scoped values
      (${recordId}::uuid, ${tenantId}::uuid, ${organizationId}::uuid),
      (${otherRecordId}::uuid, ${otherTenantId}::uuid, ${otherOrganizationId}::uuid)`.execute(db)
  })

  afterAll(async () => {
    resetEntityScopeColumnsCacheForTests()
    if (db) await db.destroy()
    if (admin) {
      await sql`drop schema if exists ${sql.id(schema)} cascade`.execute(admin)
      await admin.destroy()
    }
  })

  beforeEach(() => {
    resetEntityScopeColumnsCacheForTests()
    queries.length = 0
  })

  function context() {
    const enqueue = jest.fn<Promise<void>, [Job]>().mockResolvedValue(undefined)
    const fork = jest.fn(() => ({
      getKysely: <Database = unknown>() => db as unknown as Kysely<Database>,
      getMetadata: () => ({
        find: (className: string) => metadata.find((entry) => entry.className === className),
        getAll: () => new Map(metadata.map((entry) => [entry.className, entry])),
      }),
    }))
    const ctx: Context = {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return { fork } as T
        if (name === 'fulltextIndexQueue' || name === 'vectorIndexQueue') return { enqueue } as T
        throw new Error(`[internal] Unknown test dependency: ${name}`)
      },
    }
    return { ctx, enqueue, fork }
  }

  it.each(subscribers)('%s skips global records without querying nonexistent scope columns', async (_name, handle, entityKey) => {
    const { ctx, enqueue, fork } = context()
    await handle({ [entityKey]: 'scope_tests:scope_global', recordId }, ctx)
    expect(fork).toHaveBeenCalledTimes(1)
    expect(queries).toEqual([])
    expect(enqueue).not.toHaveBeenCalled()
  })

  it.each(subscribers)('%s reads tenant-only scope and enqueues the owning tenant', async (_name, handle, entityKey, jobType) => {
    const { ctx, enqueue } = context()
    await handle({ [entityKey]: 'scope_tests:scope_tenant', recordId }, ctx)
    expect(queries).toEqual(['select "tenant_id" from "scope_tenant" where "id" = $1'])
    expect(enqueue).toHaveBeenCalledWith({ jobType, entityType: 'scope_tests:scope_tenant', recordId, tenantId, organizationId: null })
  })

  it.each(subscribers)('%s reads organization scope without assigning another record owner', async (_name, handle, entityKey, jobType) => {
    const { ctx, enqueue } = context()
    await handle({ [entityKey]: 'scope_tests:scope_scoped', recordId }, ctx)
    await handle({ [entityKey]: 'scope_tests:scope_scoped', recordId: otherRecordId }, ctx)
    expect(queries).toEqual([
      'select "organization_id", "tenant_id" from "scope_scoped" where "id" = $1',
      'select "organization_id", "tenant_id" from "scope_scoped" where "id" = $1',
    ])
    expect(enqueue.mock.calls.map(([job]) => job)).toEqual([
      { jobType, entityType: 'scope_tests:scope_scoped', recordId, tenantId, organizationId },
      { jobType, entityType: 'scope_tests:scope_scoped', recordId: otherRecordId, tenantId: otherTenantId, organizationId: otherOrganizationId },
    ])
  })

  it.each(subscribers)('%s does not queue a nonexistent record', async (_name, handle, entityKey) => {
    const { ctx, enqueue } = context()
    await handle({ [entityKey]: 'scope_tests:scope_scoped', recordId: randomUUID() }, ctx)
    expect(enqueue).not.toHaveBeenCalled()
    expect(queries).toHaveLength(1)
  })

  it.each(subscribers)('%s probes unregistered tables and selects only existing scope columns', async (_name, handle, entityKey, jobType) => {
    const { ctx, enqueue } = context()
    await handle({ [entityKey]: 'scope_tests:scope_probed', recordId }, ctx)
    expect(queries[0]).toContain('information_schema"."columns')
    expect(queries[1]).toBe('select "tenant_id" from "scope_probeds" where "id" = $1')
    expect(enqueue).toHaveBeenCalledWith({ jobType, entityType: 'scope_tests:scope_probed', recordId, tenantId, organizationId: null })
  })
})
