/**
 * Behavioural cover for #8637 against a real PostgreSQL: `buildIndexDoc`'s optional
 * `entity_translations` read used to run inside a bare `try { ... } catch {}`. In Postgres a
 * failed statement aborts the *whole* surrounding transaction (25P02) even though the JS error
 * is caught, so when `buildIndexDoc` runs inside a caller's transaction (subscribers/batch
 * writers pass a transactional `em`), every later statement in that transaction failed with an
 * unrelated 25P02 and the real cause (here: a missing `organization_id` column) never surfaced.
 * The sibling `indexer.test.ts` exercises `buildIndexDoc` against a fake Kysely that cannot
 * reproduce Postgres transaction-abort semantics; this suite pins the real behaviour.
 *
 * Gated on OM_QUERY_INDEX_PG_URL (or the pre-existing OM_COUNT_CAP_PG_URL) — a throwaway
 * database, since the suite creates and drops its own tables. Run it with, for example:
 *
 *   docker run -d --rm --name om-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54372:5432 postgres:18-alpine
 *   OM_QUERY_INDEX_PG_URL=postgres://postgres:postgres@127.0.0.1:54372/om \
 *     yarn workspace @open-mercato/core jest build-index-doc-translations.pg
 */
import { Kysely, PostgresDialect, sql } from 'kysely'
import { buildIndexDoc } from '../lib/indexer'

const PG_URL = process.env.OM_QUERY_INDEX_PG_URL ?? process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip

const ENTITY = 'txncheck:widget'
const TENANT = '55555555-5555-4555-8555-555555555555'
const ORG_A = '66666666-6666-4666-8666-666666666666'

maybe('buildIndexDoc entity_translations read does not poison the caller transaction', () => {
  jest.setTimeout(60_000)
  let db: Kysely<any>

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg')
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: PG_URL }) }) })

    await sql`create table if not exists widgets (
      id uuid primary key,
      title text not null,
      organization_id uuid,
      tenant_id uuid
    )`.execute(db)
    await sql`create table if not exists custom_field_values (
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
    await sql`create table if not exists indexer_error_logs (
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
    await sql`drop table if exists indexer_error_logs`.execute(db)
    await sql`drop table if exists custom_field_values`.execute(db)
    await sql`drop table if exists widgets`.execute(db)
    await sql`drop table if exists entity_translations`.execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`truncate table widgets, custom_field_values, indexer_error_logs`.execute(db)
    await sql`drop table if exists entity_translations`.execute(db)
  })

  const fakeEm = (executor: Kysely<any>) => ({ getKysely: () => executor }) as any

  it('keeps the enclosing transaction usable when entity_translations is missing a queried column', async () => {
    // Reproduces the issue's repro steps: entity_translations exists but is missing the
    // `organization_id` column the read queries — a partially migrated database, not a
    // missing table, so the information_schema table-existence probe alone would not catch it.
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
      // The optional read failed, but the base document still builds.
      expect(doc).toBeTruthy()
      expect(doc!.title).toBe('Widget One')

      // The load-bearing assertion: a later statement in the SAME transaction must still
      // succeed. Under the old bare `try { ... } catch {}`, Postgres had already aborted this
      // transaction (25P02) and this query would throw "current transaction is aborted".
      const stillWorks = await trx
        .selectFrom('widgets' as any)
        .select(['id' as any])
        .where('id' as any, '=', recordId)
        .executeTakeFirst()
      expect(stillWorks).toBeTruthy()
    })

    const errorRows = await sql<{ message: string; source: string; handler: string }>`
      select message, source, handler from indexer_error_logs where entity_type = ${ENTITY}
    `.execute(db)
    expect(errorRows.rows.length).toBe(1)
    expect(errorRows.rows[0].source).toBe('query_index')
    expect(errorRows.rows[0].handler).toBe('query_index:build-index-doc:translations')
    // The real cause (missing column) is what got recorded, not a downstream 25P02.
    expect(errorRows.rows[0].message).toMatch(/organization_id/)
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
  })
})
