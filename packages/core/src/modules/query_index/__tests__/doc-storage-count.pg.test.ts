/**
 * Pins the doc-storage count semantics against a real PostgreSQL (#5228
 * review, minor 6): the count changed from `count(distinct entity_id)` to
 * `count(*)`, which differs when a scope spans organizations holding rows for
 * the same record id. The intended semantics is "count what the item list
 * returns" — the list yields one row per storage row, so the count must too;
 * the old `distinct` could under-report relative to `items`.
 *
 * Gated on OM_COUNT_CAP_PG_URL (a throwaway database — the suite creates and
 * drops its own tables). See count-cap-plan.test.ts in @open-mercato/shared
 * for the invocation recipe.
 */
import { Kysely, PostgresDialect, sql } from 'kysely'
import { HybridQueryEngine } from '../lib/engine'

const PG_URL = process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const ENTITY = 'capcheck:doc_thing'

maybe('doc-storage COUNT across a multi-organization scope', () => {
  jest.setTimeout(60_000)
  let db: Kysely<any>
  const originalCap = process.env.OM_LIST_COUNT_CAP

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg')
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: PG_URL }) }) })
    await sql`create table if not exists custom_entities (
      id serial primary key,
      entity_id text not null,
      is_active boolean not null default true
    )`.execute(db)
    await sql`create table if not exists custom_entities_storage (
      id serial primary key,
      entity_type text not null,
      entity_id text not null,
      organization_id uuid,
      tenant_id uuid not null,
      deleted_at timestamptz,
      doc jsonb not null,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    )`.execute(db)
    await sql`delete from custom_entities where entity_id = ${ENTITY}`.execute(db)
    await sql`delete from custom_entities_storage where entity_type = ${ENTITY}`.execute(db)
    await sql`insert into custom_entities (entity_id, is_active) values (${ENTITY}, true)`.execute(db)
    // The same record id present in two organizations, plus one org-A-only record.
    await sql`insert into custom_entities_storage (entity_type, entity_id, organization_id, tenant_id, doc) values
      (${ENTITY}, 'rec-shared', ${ORG_A}::uuid, ${TENANT}::uuid, '{"name":"a"}'),
      (${ENTITY}, 'rec-shared', ${ORG_B}::uuid, ${TENANT}::uuid, '{"name":"b"}'),
      (${ENTITY}, 'rec-a-only', ${ORG_A}::uuid, ${TENANT}::uuid, '{"name":"c"}')`.execute(db)
  })

  afterAll(async () => {
    await sql`delete from custom_entities where entity_id = ${ENTITY}`.execute(db)
    await sql`delete from custom_entities_storage where entity_type = ${ENTITY}`.execute(db)
    await db.destroy()
  })

  afterEach(() => {
    if (originalCap === undefined) delete process.env.OM_LIST_COUNT_CAP
    else process.env.OM_LIST_COUNT_CAP = originalCap
  })

  const makeEngine = () => {
    const em = { getKysely: () => db } as any
    const fallback = { query: jest.fn() }
    return new HybridQueryEngine(em, fallback as any, () => ({ emitEvent: jest.fn().mockResolvedValue(undefined) }))
  }

  test('total counts storage rows — exactly what the item list returns', async () => {
    process.env.OM_LIST_COUNT_CAP = '0'
    const result = await makeEngine().query(ENTITY, {
      tenantId: TENANT,
      organizationIds: [ORG_A, ORG_B],
      fields: ['id'],
      page: { page: 1, pageSize: 100 },
    })
    // Two orgs hold a row for rec-shared: the list returns both rows, and the
    // count agrees (the old count(distinct entity_id) reported 2 here while
    // the list returned 3 — an under-report relative to items).
    expect(result.items.length).toBe(3)
    expect(result.total).toBe(3)
  })

  test('single-organization scope: distinct and row counts coincide', async () => {
    process.env.OM_LIST_COUNT_CAP = '0'
    const result = await makeEngine().query(ENTITY, {
      tenantId: TENANT,
      organizationId: ORG_A,
      fields: ['id'],
      page: { page: 1, pageSize: 100 },
    })
    expect(result.items.length).toBe(2)
    expect(result.total).toBe(2)
  })
})
