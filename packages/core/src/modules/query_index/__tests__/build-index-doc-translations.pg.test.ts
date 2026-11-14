/**
 * Real PostgreSQL regression for optional translation reads aborting the caller's transaction.
 * OM_QUERY_INDEX_PG_URL (or OM_COUNT_CAP_PG_URL) enables the suite. Every connection searches
 * only its random private schema; destructive fixture statements also qualify that schema.
 */
import crypto from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { buildIndexDoc } from '../lib/indexer'

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const PG_URL = process.env.OM_QUERY_INDEX_PG_URL ?? process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip
const ENTITY = 'txncheck:widget'
const TENANT = '55555555-5555-4555-8555-555555555555'
const ORG_A = '66666666-6666-4666-8666-666666666666'
const SCHEMA = `om_test_${crypto.randomBytes(8).toString('hex')}`

maybe('buildIndexDoc entity_translations read does not poison the caller transaction', () => {
  jest.setTimeout(60_000)
  let db: Kysely<Record<string, never>>
  let schemaCreated = false

  beforeAll(async () => {
    db = new Kysely<Record<string, never>>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: PG_URL, options: `-c search_path=${SCHEMA}`, max: 2 }),
      }),
    })
    await sql`create schema ${sql.id(SCHEMA)}`.execute(db)
    schemaCreated = true
    const searchPath = await sql<{ schemas: string[] }>`select current_schemas(false)::text[] as schemas`.execute(db)
    expect(searchPath.rows[0].schemas).toEqual([SCHEMA])

    await sql`create table widgets (
      id uuid primary key,
      title text not null,
      organization_id uuid,
      tenant_id uuid
    )`.execute(db)
    await sql`create table custom_field_values (
      id uuid primary key default gen_random_uuid(),
      entity_id text not null,
      record_id text not null,
      organization_id uuid null,
      tenant_id uuid null,
      field_key text not null,
      value_text text null,
      value_multiline text null,
      value_int int null,
      value_float real null,
      value_bool boolean null,
      created_at timestamptz not null default now(),
      deleted_at timestamptz null
    )`.execute(db)
    await sql`create table indexer_error_logs (
      id uuid primary key default gen_random_uuid(),
      source text not null,
      handler text not null,
      entity_type text null,
      record_id text null,
      tenant_id uuid null,
      organization_id uuid null,
      payload jsonb null,
      message text not null,
      stack text null,
      occurred_at timestamptz not null
    )`.execute(db)
  })

  afterAll(async () => {
    if (!db) return
    try {
      if (schemaCreated) await sql`drop schema if exists ${sql.id(SCHEMA)} cascade`.execute(db)
    } finally {
      await db.destroy()
    }
  })

  beforeEach(async () => {
    mockReportError.mockReset()
    await sql`truncate table ${sql.id(SCHEMA, 'widgets')}, ${sql.id(SCHEMA, 'custom_field_values')}, ${sql.id(SCHEMA, 'indexer_error_logs')}`.execute(db)
    await sql`drop table if exists ${sql.id(SCHEMA, 'entity_translations')}`.execute(db)
  })

  const fakeEm = (executor: Kysely<Record<string, never>>) => ({ getKysely: () => executor }) as unknown as EntityManager

  it('keeps the enclosing transaction usable when entity_translations is missing a queried column', async () => {
    await sql`create table entity_translations (
      id uuid primary key default gen_random_uuid(),
      entity_type text not null,
      entity_id text not null,
      tenant_id uuid null,
      translations jsonb not null default '{}'::jsonb
    )`.execute(db)

    const recordId = '77777777-7777-4777-8777-777777777771'
    await sql`insert into widgets (id, title, organization_id, tenant_id) values
      (${recordId}::uuid, ${'Widget One'}, ${ORG_A}::uuid, ${TENANT}::uuid)`.execute(db)

    await db.transaction().execute(async (trx) => {
      const doc = await buildIndexDoc(fakeEm(trx), {
        entityType: ENTITY,
        recordId,
        organizationId: ORG_A,
        tenantId: TENANT,
      })
      expect(doc).toBeTruthy()
      expect(doc!.title).toBe('Widget One')

      const stillWorks = await sql<{ id: string }>`select id from widgets where id = ${recordId}::uuid`.execute(trx)
      expect(stillWorks.rows).toHaveLength(1)
    })

    const errorRows = await sql<{ message: string; source: string; handler: string }>`
      select message, source, handler from indexer_error_logs where entity_type = ${ENTITY}
    `.execute(db)
    expect(errorRows.rows.length).toBe(1)
    expect(errorRows.rows[0].source).toBe('query_index')
    expect(errorRows.rows[0].handler).toBe('query_index:build-index-doc:translations')
    expect(errorRows.rows[0].message).toMatch(/organization_id/)
    expect(mockReportError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('organization_id') }), {
      module: 'query_index',
      code: 'query_index.translations_read_failed',
    })
  })

  it('still attaches translations under flat l10n keys inside a transaction when the read succeeds', async () => {
    await sql`create table entity_translations (
      id uuid primary key default gen_random_uuid(),
      entity_type text not null,
      entity_id text not null,
      organization_id uuid null,
      tenant_id uuid null,
      translations jsonb not null default '{}'::jsonb
    )`.execute(db)

    const recordId = '77777777-7777-4777-8777-777777777772'
    await sql`insert into widgets (id, title, organization_id, tenant_id) values
      (${recordId}::uuid, ${'Widget Two'}, ${ORG_A}::uuid, ${TENANT}::uuid)`.execute(db)
    await sql`insert into entity_translations (entity_type, entity_id, organization_id, tenant_id, translations) values
      (${ENTITY}, ${recordId}, ${ORG_A}::uuid, ${TENANT}::uuid, ${JSON.stringify({ fr: { title: 'Widget Deux' } })}::jsonb)`
      .execute(db)

    const doc = await db.transaction().execute(async (trx) => buildIndexDoc(fakeEm(trx), {
      entityType: ENTITY,
      recordId,
      organizationId: ORG_A,
      tenantId: TENANT,
    }))

    expect(doc?.['l10n:fr:title']).toBe('Widget Deux')

    const errorRows = await sql<{ id: string }>`
      select id from indexer_error_logs where entity_type = ${ENTITY}
    `.execute(db)
    expect(errorRows.rows.length).toBe(0)
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it.each(['missing', 'rejects inserts'])('keeps the transaction usable when indexer_error_logs %s', async (failure) => {
    const recordId = crypto.randomUUID()
    await sql`insert into widgets (id, title) values (${recordId}::uuid, 'Logging failure')`.execute(db)

    await db.transaction().execute(async (trx) => {
      if (failure === 'missing') {
        await sql`drop table ${sql.id(SCHEMA, 'indexer_error_logs')}`.execute(trx)
      } else {
        await sql`alter table ${sql.id(SCHEMA, 'indexer_error_logs')} add check (source <> 'query_index')`.execute(trx)
      }
      const doc = await buildIndexDoc(fakeEm(trx), { entityType: ENTITY, recordId })
      expect(doc?.title).toBe('Logging failure')
      expect(mockReportError).toHaveBeenCalledWith(expect.anything(), {
        module: 'query_index',
        code: 'query_index.translations_log_failed',
      })
      const stillWorks = await sql<{ alive: number }>`select 1 as alive`.execute(trx)
      expect(stillWorks.rows[0].alive).toBe(1)
      throw new Error('[internal] Roll back fixture change')
    }).catch((error: unknown) => {
      expect(error).toEqual(new Error('[internal] Roll back fixture change'))
    })
  })

  it('recovers from repeated missing-table reads and a throwing telemetry sink', async () => {
    mockReportError.mockImplementation(() => { throw new Error('[internal] Telemetry unavailable') })
    const recordId = crypto.randomUUID()
    await sql`insert into widgets (id, title) values (${recordId}::uuid, 'Repeated read')`.execute(db)

    await db.transaction().execute(async (trx) => {
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const doc = await buildIndexDoc(fakeEm(trx), { entityType: ENTITY, recordId })
        expect(doc?.title).toBe('Repeated read')
        const stillWorks = await sql<{ alive: number }>`select 1 as alive`.execute(trx)
        expect(stillWorks.rows[0].alive).toBe(1)
      }
    })

    const errors = await sql<{ count: string }>`select count(*) from indexer_error_logs`.execute(db)
    expect(Number(errors.rows[0].count)).toBe(3)
  })

  it('logs a failed optional read without an enclosing transaction', async () => {
    const recordId = crypto.randomUUID()
    await sql`insert into widgets (id, title) values (${recordId}::uuid, 'Plain connection')`.execute(db)
    const doc = await buildIndexDoc(fakeEm(db), { entityType: ENTITY, recordId })
    expect(doc?.title).toBe('Plain connection')
    const errors = await sql<{ message: string }>`select message from indexer_error_logs`.execute(db)
    expect(errors.rows).toHaveLength(1)
    expect(errors.rows[0].message).toContain('entity_translations')
  })
})
