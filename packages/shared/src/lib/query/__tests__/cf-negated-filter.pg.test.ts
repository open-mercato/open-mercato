/**
 * Real PostgreSQL proof for #10168: on the non-indexed BasicQueryEngine path, cf `ne` / `nin`
 * exclude a record when ANY of its multi-value rows equals an excluded value, on both the page
 * and the count query, so the reported total matches the page.
 *
 * Gated on OM_COUNT_CAP_PG_URL (a throwaway database). The suite works in a random private
 * schema and drops it afterwards. Example:
 *   docker run --rm -d -p 54329:5432 -e POSTGRES_PASSWORD=t postgres:16
 *   OM_COUNT_CAP_PG_URL=postgres://postgres:t@localhost:54329/postgres yarn jest cf-negated-filter.pg
 */
import crypto from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { BasicQueryEngine } from '../engine'

const PG_URL = process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip
const SCHEMA = `om_test_${crypto.randomBytes(8).toString('hex')}`

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ENTITY = 'cfcheck:om_cfneg_widget'

const RECORDS: Record<string, { id: string; name: string; labels: Array<string | null> }> = {
  multi_ab: { id: '33333333-3333-4333-8333-000000000001', name: 'multi_ab', labels: ['a', 'b'] },
  multi_b: { id: '33333333-3333-4333-8333-000000000002', name: 'multi_b', labels: ['b'] },
  single_a: { id: '33333333-3333-4333-8333-000000000003', name: 'single_a', labels: ['a'] },
  single_c: { id: '33333333-3333-4333-8333-000000000004', name: 'single_c', labels: ['c'] },
  unset: { id: '33333333-3333-4333-8333-000000000005', name: 'unset', labels: [] },
  null_row: { id: '33333333-3333-4333-8333-000000000006', name: 'null_row', labels: [null] },
}

maybe('BasicQueryEngine cf ne/nin on multi-value fields against PostgreSQL (#10168)', () => {
  jest.setTimeout(60_000)
  let db: Kysely<any>
  let schemaCreated = false

  beforeAll(async () => {
    db = new Kysely<any>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: PG_URL, options: `-c search_path=${SCHEMA}`, max: 2 }),
      }),
    })
    await sql`create schema ${sql.id(SCHEMA)}`.execute(db)
    schemaCreated = true
    await sql`create table om_cfneg_widgets (
      id uuid primary key,
      tenant_id uuid not null,
      organization_id uuid not null,
      deleted_at timestamptz,
      name text not null
    )`.execute(db)
    await sql`create table custom_field_defs (
      id uuid primary key default gen_random_uuid(),
      entity_id text not null,
      key text not null,
      kind text not null,
      config_json jsonb,
      is_active boolean not null default true,
      tenant_id uuid,
      organization_id uuid,
      updated_at timestamptz,
      deleted_at timestamptz
    )`.execute(db)
    await sql`create table custom_field_values (
      id uuid primary key default gen_random_uuid(),
      entity_id text not null,
      record_id text not null,
      field_key text not null,
      tenant_id uuid,
      organization_id uuid,
      value_text text,
      value_multiline text,
      value_int integer,
      value_float double precision,
      value_bool boolean
    )`.execute(db)
    await db.insertInto('custom_field_defs').values({
      entity_id: ENTITY, key: 'labels', kind: 'select', config_json: JSON.stringify({ multi: true }), tenant_id: TENANT,
    }).execute()
    for (const record of Object.values(RECORDS)) {
      await db.insertInto('om_cfneg_widgets').values({ id: record.id, tenant_id: TENANT, organization_id: ORG, name: record.name }).execute()
      for (const label of record.labels) {
        await db.insertInto('custom_field_values').values({
          entity_id: ENTITY, record_id: record.id, field_key: 'labels', tenant_id: TENANT, organization_id: ORG, value_text: label,
        }).execute()
      }
    }
  })

  afterAll(async () => {
    if (schemaCreated) await sql`drop schema ${sql.id(SCHEMA)} cascade`.execute(db)
    await db?.destroy()
  })

  const run = async (filters: Record<string, unknown>) => {
    const result = await new BasicQueryEngine({} as never, () => db).query(ENTITY, {
      tenantId: TENANT,
      organizationId: ORG,
      fields: ['id', 'name', 'cf:labels'],
      sort: [{ field: 'name', dir: 'asc' as never }],
      filters,
      page: { page: 1, pageSize: 50 },
    })
    const items = result.items as Array<{ name: string; cf_labels?: unknown }>
    return { names: items.map((item) => item.name), items, total: result.total }
  }

  test('eq still matches every record holding the value (sanity)', async () => {
    const result = await run({ 'cf:labels': { $eq: 'a' } })
    expect(result.names).toEqual(['multi_ab', 'single_a'])
    expect(result.total).toBe(2)
  })

  test('ne excludes a record when any of its values equals the excluded value', async () => {
    const result = await run({ 'cf:labels': { $ne: 'a' } })
    expect(result.names).toEqual(['multi_b', 'single_c'])
    expect(result.total).toBe(2)
  })

  test('nin excludes a record when any of its values equals any excluded value', async () => {
    const result = await run({ 'cf:labels': { $nin: ['a', 'c'] } })
    expect(result.names).toEqual(['multi_b'])
    expect(result.total).toBe(1)
  })

  test('ne inside an OR group keeps the same set semantics on page and count', async () => {
    const result = await run({ $or: [{ 'cf:labels': { $ne: 'a' } }, { name: { $eq: 'unset' } }] })
    expect(result.names).toEqual(['multi_b', 'single_c', 'unset'])
    expect(result.total).toBe(3)
  })

  test('a matching multi-value record keeps its full value list in the projection', async () => {
    const result = await run({ 'cf:labels': { $ne: 'c' } })
    expect(result.names).toEqual(['multi_ab', 'multi_b', 'single_a'])
    expect(result.total).toBe(3)
    const multi = result.items.find((item) => item.name === 'multi_ab') as Record<string, unknown>
    const labels = multi['cf:labels'] ?? multi.cf_labels
    expect([...(labels as string[])].sort()).toEqual(['a', 'b'])
  })

  test('ne null still means the field is set', async () => {
    const result = await run({ 'cf:labels': { $ne: null } })
    expect(result.names).toEqual(['multi_ab', 'multi_b', 'single_a', 'single_c'])
    expect(result.total).toBe(4)
  })

  test('an empty nin still excludes nothing', async () => {
    const result = await run({ 'cf:labels': { $nin: [] } })
    expect(result.total).toBe(Object.keys(RECORDS).length)
  })

  test('a null in a nin list adds nothing beyond "the field is set"', async () => {
    const mixed = await run({ 'cf:labels': { $nin: [null, 'a'] } })
    expect(mixed.names).toEqual(['multi_b', 'single_c'])
    expect(mixed.total).toBe(2)
    const nullOnly = await run({ 'cf:labels': { $nin: [null] } })
    expect(nullOnly.names).toEqual(['multi_ab', 'multi_b', 'single_a', 'single_c'])
    expect(nullOnly.total).toBe(4)
  })
})
