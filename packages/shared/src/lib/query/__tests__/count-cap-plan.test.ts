/**
 * Plan-level guard for the capped list COUNT (#4552 Phase 2), run against a real
 * PostgreSQL. This is the only test that fails if a future refactor reintroduces
 * a blocking node (Aggregate/Sort/Unique) between the probe `Limit` and the base
 * scan — a mocked total cannot catch a bound that does not bind. It doubles as
 * the count-parity check: with the cap disabled, the rebuilt count must equal
 * ground truth across the cf-filter / or-group / plain matrices.
 *
 * Gated on OM_COUNT_CAP_PG_URL (a throwaway database — the suite creates and
 * drops its own tables). Example:
 *   docker run --rm -d -p 54329:5432 -e POSTGRES_PASSWORD=t postgres:16
 *   OM_COUNT_CAP_PG_URL=postgres://postgres:t@localhost:54329/postgres yarn jest count-cap-plan
 */
import { Kysely, PostgresDialect, sql } from 'kysely'
import { BasicQueryEngine } from '../engine'

const PG_URL = process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ENTITY = 'capcheck:om_capcheck_order'
const TABLE = 'om_capcheck_orders'
const ROWS = 120
const RED_ROWS = 30

maybe('capped list COUNT against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let db: Kysely<any>
  let sqlLog: string[] = []
  let paramLog: unknown[][] = []
  const originalCap = process.env.OM_LIST_COUNT_CAP

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg')
    db = new Kysely<any>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: PG_URL }) }),
      log(event) {
        if (event.level === 'query' || event.level === 'error') {
          sqlLog.push(event.query.sql)
          paramLog.push([...event.query.parameters])
        }
      },
    })
    await sql`drop table if exists om_capcheck_orders`.execute(db)
    await sql`create table om_capcheck_orders (
      id uuid primary key,
      tenant_id uuid not null,
      organization_id uuid not null,
      deleted_at timestamptz,
      status text not null
    )`.execute(db)
    await sql`create table if not exists custom_field_defs (
      id serial primary key,
      key text not null,
      entity_id text not null,
      kind text,
      config_json jsonb,
      is_active boolean not null default true,
      organization_id uuid,
      tenant_id uuid,
      updated_at timestamptz,
      deleted_at timestamptz
    )`.execute(db)
    await sql`create table if not exists custom_field_values (
      id serial primary key,
      entity_id text not null,
      field_key text not null,
      record_id text not null,
      value_text text,
      value_multiline text,
      value_int int,
      value_float float,
      value_bool boolean,
      organization_id uuid,
      tenant_id uuid
    )`.execute(db)
    await sql`delete from custom_field_defs where entity_id = ${ENTITY}`.execute(db)
    await sql`delete from custom_field_values where entity_id = ${ENTITY}`.execute(db)
    await sql`insert into custom_field_defs (key, entity_id, kind, is_active, tenant_id)
      values ('color', ${ENTITY}, 'text', true, null)`.execute(db)
    for (let i = 0; i < ROWS; i++) {
      const id = `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`
      await sql`insert into om_capcheck_orders (id, tenant_id, organization_id, deleted_at, status)
        values (${id}::uuid, ${TENANT}::uuid, ${ORG}::uuid, null, ${i % 2 === 0 ? 'open' : 'closed'})`.execute(db)
      if (i < RED_ROWS) {
        await sql`insert into custom_field_values (entity_id, field_key, record_id, value_text, tenant_id)
          values (${ENTITY}, 'color', ${id}, 'red', ${TENANT}::uuid)`.execute(db)
      }
    }
  })

  afterAll(async () => {
    await sql`drop table if exists om_capcheck_orders`.execute(db)
    await sql`delete from custom_field_defs where entity_id = ${ENTITY}`.execute(db)
    await sql`delete from custom_field_values where entity_id = ${ENTITY}`.execute(db)
    await db.destroy()
  })

  afterEach(() => {
    if (originalCap === undefined) delete process.env.OM_LIST_COUNT_CAP
    else process.env.OM_LIST_COUNT_CAP = originalCap
  })

  const makeEngine = () => new BasicQueryEngine({} as any, () => db as any)
  const baseOpts = {
    tenantId: TENANT,
    organizationId: ORG,
    fields: ['id'],
    page: { page: 1, pageSize: 10 },
  }

  function lastCountSql(): { text: string; params: unknown[] } {
    for (let i = sqlLog.length - 1; i >= 0; i--) {
      if (/count\(\*\)/i.test(sqlLog[i])) return { text: sqlLog[i], params: paramLog[i] }
    }
    throw new Error('no count SQL captured')
  }

  function collectNodes(node: any, out: any[] = []): any[] {
    if (!node) return out
    out.push(node)
    for (const child of node.Plans ?? []) collectNodes(child, out)
    return out
  }

  test('probe plan: no blocking node between the Limit and the base scan (cf-filtered)', async () => {
    process.env.OM_LIST_COUNT_CAP = '50'
    sqlLog = []; paramLog = []
    const result = await makeEngine().query(ENTITY, {
      ...baseOpts,
      filters: { status: { $eq: 'open' } },
    })
    expect(result.total).toBe(50)
    expect(result.meta?.listCountCapWarning).toEqual({ entity: ENTITY, cap: 50 })

    const { text, params } = lastCountSql()
    expect(text.toLowerCase()).toContain('limit')
    const explained = await sql
      .raw(`explain (format json) ${text.replace(/\$(\d+)/g, (_, n) => {
        const value = params[Number(n) - 1]
        return typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`
      })}`)
      .execute(db)
    const plan = (explained.rows[0] as any)['QUERY PLAN'][0].Plan
    const all = collectNodes(plan)
    const limitNode = all.find((n) => n['Node Type'] === 'Limit')
    expect(limitNode).toBeTruthy()
    // Below the Limit: only row-producing nodes down to the scan. An Aggregate,
    // Sort, or Unique here means the bound does not bind.
    const belowLimit = collectNodes(limitNode).slice(1)
    const blocking = belowLimit.filter((n) => /Aggregate|Sort|Unique/.test(String(n['Node Type'])))
    expect(blocking).toEqual([])
    // The base scan is inside the Limit subtree.
    expect(belowLimit.some((n) => n['Relation Name'] === TABLE)).toBe(true)
  })

  test('cf filter compiles to EXISTS and stays cappable', async () => {
    process.env.OM_LIST_COUNT_CAP = '10'
    sqlLog = []; paramLog = []
    const result = await makeEngine().query(ENTITY, {
      ...baseOpts,
      filters: { cf_color: { $eq: 'red' } },
    })
    expect(result.total).toBe(10)
    expect(result.meta?.listCountCapWarning).toEqual({ entity: ENTITY, cap: 10 })
    const { text } = lastCountSql()
    expect(text.toLowerCase()).toContain('exists')
    expect(text.toLowerCase()).not.toContain('group by')
  })

  test('parity with the cap disabled: rebuilt count matches the display query across the filter matrix', async () => {
    process.env.OM_LIST_COUNT_CAP = '0'
    const engine = makeEngine()
    const wide = { page: { page: 1, pageSize: 1000 } }

    // Each case asserts the rebuilt count against ground truth where the filter
    // semantics are well-defined, and always against the display query's own
    // row set — the regression guard for "count rebuild changing a total".
    const expectParity = async (filters: any, expectedTotal?: number) => {
      const result = await engine.query(ENTITY, { ...baseOpts, ...wide, filters })
      expect(result.total).toBe(result.items.length)
      if (expectedTotal !== undefined) expect(result.total).toBe(expectedTotal)
      expect(result.meta?.listCountCapWarning).toBeUndefined()
      return result
    }

    await expectParity(undefined, ROWS)
    await expectParity({ status: { $eq: 'open' } }, ROWS / 2)
    await expectParity({ cf_color: { $eq: 'red' } }, RED_ROWS)
    await expectParity({ $and: [{ status: { $eq: 'open' } }, { cf_color: { $eq: 'red' } }] }, RED_ROWS / 2)
    // Base-column-only $or exercises the or-group path in the count shape.
    await expectParity({ $or: [{ status: { $eq: 'open' } }, { status: { $eq: 'closed' } }] }, ROWS)
    // Mixed base + cf disjunction (#5039): the count shape must compile the cf
    // leaf to an EXISTS rather than dropping it — a dropped leaf narrows the OR
    // and undercounts. closed (60) ∪ red (30, half of which are closed) = 75.
    await expectParity({ $or: [{ status: { $eq: 'closed' } }, { cf_color: { $eq: 'red' } }] }, ROWS / 2 + RED_ROWS / 2)
    // cf-only disjunction: red (30) ∪ blue (0) = 30.
    await expectParity({ $or: [{ cf_color: { $eq: 'red' } }, { cf_color: { $eq: 'blue' } }] }, RED_ROWS)
    await expectParity({ cf_color: { $eq: 'blue' } }, 0)
    await expectParity({ cf_color: { $eq: null } }, ROWS - RED_ROWS)
    await expectParity({ cf_color: { $ne: 'red' } }, 0)
    await expectParity({ cf_color: { $in: ['red', 'blue'] } }, RED_ROWS)
  })

  test('sub-cap totals stay exact with the cap active', async () => {
    process.env.OM_LIST_COUNT_CAP = '1000'
    const result = await makeEngine().query(ENTITY, { ...baseOpts, filters: { cf_color: { $eq: 'red' } } })
    expect(result.total).toBe(RED_ROWS)
    expect(result.meta?.listCountCapWarning).toBeUndefined()
  })
})
