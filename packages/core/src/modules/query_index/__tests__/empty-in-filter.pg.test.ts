/**
 * End-to-end proof for #7502 against a real PostgreSQL: a `?ids=` filter that
 * leaves no valid id (`{ id: { $in: [] } }`, the shape `mergeIdFilter` produces
 * for an unparseable or disjoint id list) must answer an empty page on the
 * HybridQueryEngine too, not a 42601 syntax error from Kysely compiling `in ()`.
 * This is the engine the issue's own repro trace names (`HybridQueryEngine.query
 * → runBoundedCount`).
 *
 * Gated on OM_QUERY_INDEX_PG_URL (falling back to OM_COUNT_CAP_PG_URL, the
 * shared convention in this directory) — a throwaway database the suite
 * creates and drops its own table in. Example:
 *   docker run --rm -d -p 54329:5432 -e POSTGRES_PASSWORD=t postgres:16
 *   OM_COUNT_CAP_PG_URL=postgres://postgres:t@localhost:54329/postgres yarn jest empty-in-filter.pg
 */
import { Kysely, PostgresDialect, sql } from 'kysely'
import { HybridQueryEngine } from '../lib/engine'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'

const PG_URL = process.env.OM_QUERY_INDEX_PG_URL ?? process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ENTITY = 'capcheck:om_emptyids_hybrid_order'
const TABLE = 'om_emptyids_hybrid_orders'
const ID_A = '44444444-4444-4444-8444-000000000001'
const ID_B = '44444444-4444-4444-8444-000000000002'

maybe('HybridQueryEngine empty $in/$nin filter against PostgreSQL', () => {
  jest.setTimeout(30_000)
  let db: Kysely<any>

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg')
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: PG_URL }) }) })
    // HybridQueryEngine.isCustomEntity() unconditionally probes `custom_entities`
    // before falling through to the base-table path exercised below.
    await sql`create table if not exists custom_entities (
      id serial primary key,
      entity_id text not null,
      is_active boolean not null default true
    )`.execute(db)
    // HybridQueryEngine's base-table path left-joins `entity_indexes` unconditionally.
    await sql`create table if not exists entity_indexes (
      id uuid primary key default gen_random_uuid(),
      entity_type text not null,
      entity_id text not null,
      organization_id uuid,
      tenant_id uuid,
      doc jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    )`.execute(db)
    await sql`drop table if exists om_emptyids_hybrid_orders`.execute(db)
    await sql`create table om_emptyids_hybrid_orders (
      id uuid primary key,
      tenant_id uuid not null,
      organization_id uuid not null,
      deleted_at timestamptz,
      status text not null
    )`.execute(db)
    await sql`insert into om_emptyids_hybrid_orders (id, tenant_id, organization_id, deleted_at, status) values
      (${ID_A}::uuid, ${TENANT}::uuid, ${ORG}::uuid, null, 'open'),
      (${ID_B}::uuid, ${TENANT}::uuid, ${ORG}::uuid, null, 'closed')`.execute(db)
  })

  afterAll(async () => {
    await sql`drop table if exists om_emptyids_hybrid_orders`.execute(db)
    await sql`drop table if exists entity_indexes`.execute(db)
    await sql`drop table if exists custom_entities`.execute(db)
    await db.destroy()
  })

  const makeEngine = () => {
    const fallback = new BasicQueryEngine({} as any, () => db as any)
    return new HybridQueryEngine({ getKysely: () => db } as any, fallback)
  }
  const baseOpts = {
    tenantId: TENANT,
    organizationId: ORG,
    fields: ['id'],
    page: { page: 1, pageSize: 10 },
  }

  test('?ids= with no valid id returns an empty page instead of a 500 (AND path)', async () => {
    const result = await makeEngine().query(ENTITY, {
      ...baseOpts,
      filters: { id: { $in: [] } },
    })
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
  })

  test('a disjoint ?id=&?ids= intersection inside an $or group still matches the other disjunct', async () => {
    const result = await makeEngine().query(ENTITY, {
      ...baseOpts,
      filters: {
        $or: [
          { id: { $in: [] } },
          { status: { $eq: 'closed' } },
        ],
      },
    })
    expect(result.items.map((row: any) => row.id)).toEqual([ID_B])
    expect(result.total).toBe(1)
  })

  test('an empty $nin excludes nothing, matching every row', async () => {
    const result = await makeEngine().query(ENTITY, {
      ...baseOpts,
      filters: { id: { $nin: [] } },
    })
    expect(result.total).toBe(2)
  })
})
