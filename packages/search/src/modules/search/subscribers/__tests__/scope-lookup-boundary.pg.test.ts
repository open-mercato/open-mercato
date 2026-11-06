import { randomUUID } from 'node:crypto'
import { EntitySchema } from '@mikro-orm/core'
import { MikroORM } from '@mikro-orm/postgresql'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { resetEntityScopeColumnsCacheForTests } from '@open-mercato/shared/lib/db/recordScope'
import { resolveAutoIndexingEnabled } from '../../lib/auto-indexing'
import fulltextUpsert from '../fulltext_upsert'
import vectorUpsert from '../vector_upsert'
import vectorDelete from '../vector_delete'

jest.mock('../../lib/auto-indexing', () => ({
  resolveAutoIndexingEnabled: jest.fn().mockResolvedValue(true),
}))

const postgresUrl = process.env.OM_SEARCH_SCOPE_PG_URL
const describePostgres = postgresUrl ? describe : describe.skip

type ScopeRecord = { id: string; tenantId?: string; organizationId?: string }
const entities = [
  new EntitySchema<ScopeRecord>({
    name: 'ScopeBoundaryGlobal', tableName: 'scope_boundary_globals',
    properties: { id: { type: 'uuid', primary: true } },
  }),
  new EntitySchema<ScopeRecord>({
    name: 'ScopeBoundaryTenant', tableName: 'scope_boundary_tenants',
    properties: { id: { type: 'uuid', primary: true }, tenantId: { type: 'uuid', fieldName: 'tenant_id' } },
  }),
  new EntitySchema<ScopeRecord>({
    name: 'ScopeBoundaryScoped', tableName: 'scope_boundary_scopeds',
    properties: {
      id: { type: 'uuid', primary: true },
      tenantId: { type: 'uuid', fieldName: 'tenant_id' },
      organizationId: { type: 'uuid', fieldName: 'organization_id' },
    },
  }),
]

const handlers = [
  { event: 'search.index_record', handle: fulltextUpsert, entityKey: 'entityId', queueName: 'fulltextIndexQueue', jobType: 'index' },
  { event: 'query_index.vectorize_one', handle: vectorUpsert, entityKey: 'entityType', queueName: 'vectorIndexQueue', jobType: 'index' },
  { event: 'query_index.delete_one', handle: vectorDelete, entityKey: 'entityType', queueName: 'vectorIndexQueue', jobType: 'delete' },
] as const

describePostgres('subscriber scope lookup against real PostgreSQL records', () => {
  jest.setTimeout(60_000)
  const schema = `search_scope_${randomUUID().replaceAll('-', '')}`
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const organizationA = randomUUID()
  const organizationB = randomUUID()
  const globalId = randomUUID()
  const tenantOnlyId = randomUUID()
  const scopedAId = randomUUID()
  const scopedBId = randomUUID()
  const probeId = randomUUID()
  const statements: string[] = []
  let db: Kysely<Record<string, never>>
  let orm: MikroORM
  let schemaCreated = false

  beforeAll(async () => {
    db = new Kysely<Record<string, never>>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: postgresUrl, options: `-csearch_path=${schema}`, max: 3 }) }),
      log: (event) => { statements.push(event.query.sql) },
    })
    await sql`create schema ${sql.id(schema)}`.execute(db)
    schemaCreated = true
    const scopedUrl = new URL(postgresUrl!)
    scopedUrl.searchParams.set('options', `-csearch_path=${schema}`)
    orm = await MikroORM.init({ entities, clientUrl: scopedUrl.toString(), schema })
    for (const metadata of orm.getMetadata().getAll().values()) metadata.schema = schema
    await sql`create table ${sql.id(schema, 'scope_boundary_globals')} (id uuid primary key)`.execute(db)
    await sql`create table ${sql.id(schema, 'scope_boundary_tenants')} (id uuid primary key, tenant_id uuid not null)`.execute(db)
    await sql`create table ${sql.id(schema, 'scope_boundary_scopeds')} (id uuid primary key, tenant_id uuid not null, organization_id uuid not null)`.execute(db)
    await sql`create table ${sql.id(schema, 'scope_boundary_probes')} (id uuid primary key, tenant_id uuid not null)`.execute(db)
    await sql`insert into ${sql.id(schema, 'scope_boundary_globals')} values (${globalId}::uuid)`.execute(db)
    await sql`insert into ${sql.id(schema, 'scope_boundary_tenants')} values (${tenantOnlyId}::uuid, ${tenantA}::uuid)`.execute(db)
    await sql`insert into ${sql.id(schema, 'scope_boundary_scopeds')} values
      (${scopedAId}::uuid, ${tenantA}::uuid, ${organizationA}::uuid),
      (${scopedBId}::uuid, ${tenantB}::uuid, ${organizationB}::uuid)`.execute(db)
    await sql`insert into ${sql.id(schema, 'scope_boundary_probes')} values (${probeId}::uuid, ${tenantB}::uuid)`.execute(db)
  })

  afterAll(async () => {
    await orm?.close(true)
    if (db) {
      try {
        if (schemaCreated) await sql`drop schema ${sql.id(schema)} cascade`.execute(db)
      } finally {
        await db.destroy()
      }
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    resetEntityScopeColumnsCacheForTests()
    statements.length = 0
  })

  it.each(handlers)('$event resolves scopes before enqueueing and never borrows another record scope', async ({ handle, entityKey, queueName, jobType }) => {
    const enqueue = jest.fn().mockResolvedValue(undefined)
    const forkEm = orm.em.fork()
    const lookupEm = { getMetadata: () => forkEm.getMetadata(), getKysely: () => db }
    const requestEm = { fork: jest.fn(() => lookupEm), getKysely: jest.fn(() => { throw new Error('[internal] request connection used') }) }
    const ctx = {
      resolve: <Result,>(name: string): Result => {
        if (name === 'em') return requestEm as Result
        if (name === queueName) return { enqueue } as Result
        throw new Error(`[internal] Unexpected service: ${name}`)
      },
    }
    const emit = (entityType: string, recordId: string) => handle({ [entityKey]: entityType, recordId, tenantId: null, organizationId: null }, ctx)

    await emit('boundary:scope_boundary_global', globalId)
    expect(enqueue).not.toHaveBeenCalled()
    expect(statements).toEqual([])

    for (const [entityType, recordId, tenantId, organizationId] of [
      ['boundary:scope_boundary_tenant', tenantOnlyId, tenantA, null],
      ['boundary:scope_boundary_scoped', scopedAId, tenantA, organizationA],
      ['boundary:scope_boundary_scoped', scopedBId, tenantB, organizationB],
      ['boundary:scope_boundary_probe', probeId, tenantB, null],
    ] as const) {
      await emit(entityType, recordId)
      expect(enqueue).toHaveBeenLastCalledWith({ jobType, entityType, recordId, tenantId, organizationId })
    }
    expect(enqueue).toHaveBeenCalledTimes(4)
    expect(resolveAutoIndexingEnabled).toHaveBeenCalledTimes(4)
    await emit('boundary:scope_boundary_scoped', randomUUID())
    await emit('boundary:scope_boundary_tenant', randomUUID())
    await emit('boundary:scope_boundary_global', randomUUID())
    expect(enqueue).toHaveBeenCalledTimes(4)
    expect(requestEm.getKysely).not.toHaveBeenCalled()
    expect(requestEm.fork).toHaveBeenCalledTimes(8)
    expect(statements.some((statement) => statement.includes('information_schema'))).toBe(true)
  })

  it.each(handlers)('$event fails closed when a real catalog probe fails on its fork', async ({ handle, entityKey, queueName }) => {
    const enqueue = jest.fn().mockResolvedValue(undefined)
    await db.transaction().execute(async (transaction) => {
      await expect(sql`select 1 / 0`.execute(transaction)).rejects.toThrow()
      const ctx = {
        resolve: <Result,>(name: string): Result => {
          if (name === 'em') return { fork: () => ({ getKysely: () => transaction }) } as Result
          if (name === queueName) return { enqueue } as Result
          throw new Error(`[internal] Unexpected service: ${name}`)
        },
      }
      await handle({ [entityKey]: 'boundary:scope_boundary_probe', recordId: probeId, tenantId: null, organizationId: null }, ctx)
      expect(enqueue).not.toHaveBeenCalled()
      expect(resolveAutoIndexingEnabled).not.toHaveBeenCalled()
    })
    const result = await sql<{ alive: number }>`select 1 as alive`.execute(db)
    expect(result.rows).toEqual([{ alive: 1 }])
    expect(statements.some((statement) => statement.includes('information_schema'))).toBe(true)
  })
})
