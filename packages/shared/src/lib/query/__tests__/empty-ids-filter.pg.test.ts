/**
 * End-to-end proof for #7502 against a real PostgreSQL: a `?ids=` filter that
 * leaves no valid id (`{ id: { $in: [] } }`, the shape `mergeIdFilter` produces
 * for an unparseable or disjoint id list) must answer an empty page, not a
 * 42601 syntax error from Kysely compiling `in ()`.
 *
 * Gated on OM_COUNT_CAP_PG_URL (a throwaway database — the suite creates and
 * drops its own table). Example:
 *   docker run --rm -d -p 54329:5432 -e POSTGRES_PASSWORD=t postgres:16
 *   OM_COUNT_CAP_PG_URL=postgres://postgres:t@localhost:54329/postgres yarn jest empty-ids-filter.pg
 */
import { Kysely, PostgresDialect, sql } from 'kysely'
import { BasicQueryEngine } from '../engine'

const PG_URL = process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ENTITY = 'capcheck:om_emptyids_order'
const TABLE = 'om_emptyids_orders'
const ID_A = '33333333-3333-4333-8333-000000000001'
const ID_B = '33333333-3333-4333-8333-000000000002'

maybe('empty $in/$nin filter against PostgreSQL', () => {
  jest.setTimeout(30_000)
  let db: Kysely<any>

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg')
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: PG_URL }) }) })
    await sql`drop table if exists om_emptyids_orders`.execute(db)
    await sql`create table om_emptyids_orders (
      id uuid primary key,
      tenant_id uuid not null,
      organization_id uuid not null,
      deleted_at timestamptz,
      status text not null
    )`.execute(db)
    await sql`insert into om_emptyids_orders (id, tenant_id, organization_id, deleted_at, status) values
      (${ID_A}::uuid, ${TENANT}::uuid, ${ORG}::uuid, null, 'open'),
      (${ID_B}::uuid, ${TENANT}::uuid, ${ORG}::uuid, null, 'closed')`.execute(db)
  })

  afterAll(async () => {
    await sql`drop table if exists om_emptyids_orders`.execute(db)
    await db.destroy()
  })

  const makeEngine = () => new BasicQueryEngine({} as any, () => db as any)
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
