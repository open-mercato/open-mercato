/** @jest-environment node */
import {
  Kysely,
  PostgresAdapter,
  PostgresQueryCompiler,
  PostgresIntrospector,
  DummyDriver,
  type CompiledQuery,
} from 'kysely'
import { computeTimeEntryTotals } from '../timeEntryTotals'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const MEMBER_ID = '44444444-4444-4444-8444-444444444444'

type RowsFor = (query: CompiledQuery) => Record<string, unknown>[]

function recordingDb(rowsFor: RowsFor = () => []) {
  const queries: CompiledQuery[] = []
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<unknown>) => new PostgresIntrospector(instance),
    },
  })
  const executor = db.getExecutor() as unknown as { executeQuery: (query: CompiledQuery) => Promise<unknown> }
  executor.executeQuery = async (query: CompiledQuery) => {
    queries.push(query)
    return { rows: rowsFor(query) }
  }
  return { db, queries }
}

const scope = { tenantId: TENANT_ID, organizationIds: [ORG_ID], canSeeRates: false }

describe('computeTimeEntryTotals', () => {
  it('aggregates the whole filtered set inside the tenant and organization scope', async () => {
    const { db, queries } = recordingDb(() => [{ entry_count: '300', duration_minutes: '18000', rounded_minutes: '18015' }])
    const totals = await computeTimeEntryTotals(db, { date: { $gte: '2026-10-05', $lte: '2026-10-11' } }, scope)

    expect(totals).toEqual({ entryCount: 300, durationMinutes: 18000, roundedMinutes: 18015 })
    expect(queries).toHaveLength(1)
    const [query] = queries
    expect(query.sql).toContain('count(*)')
    expect(query.sql).not.toMatch(/\blimit\b|\boffset\b/i)
    expect(query.sql).toContain('"e"."tenant_id" = $1')
    expect(query.sql).toContain('"e"."organization_id" in ($2)')
    expect(query.sql).toContain('"e"."deleted_at" is null')
    expect(query.sql).toContain('"e"."date" >= $3')
    expect(query.sql).toContain('"e"."date" <= $4')
    expect(query.parameters).toEqual([TENANT_ID, ORG_ID, '2026-10-05', '2026-10-11'])
  })

  it('compiles the project-access branches, lists, nullness and text search of the list filters', async () => {
    const { db, queries } = recordingDb()
    await computeTimeEntryTotals(
      db,
      {
        staff_member_id: MEMBER_ID,
        locked_report_id: { $ne: null },
        notes: { $ilike: '%audit%' },
        is_billable: { $eq: true },
        $or: [
          { time_project_id: { $in: [PROJECT_ID] } },
          { time_project_id: { $eq: null }, staff_member_id: MEMBER_ID },
        ],
      },
      scope,
    )
    const sqlText = queries[0].sql
    expect(sqlText).toContain('"e"."staff_member_id" = $3')
    expect(sqlText).toContain('"e"."locked_report_id" is not null')
    expect(sqlText).toContain('"e"."notes" ilike $4')
    expect(sqlText).toContain('"e"."is_billable" = $5')
    expect(sqlText).toContain('("e"."time_project_id" in ($6) or ("e"."time_project_id" is null and "e"."staff_member_id" = $7))')
  })

  it('matches nothing for an empty id list instead of failing the query', async () => {
    const { db, queries } = recordingDb()
    await computeTimeEntryTotals(db, { id: { $in: [] } }, scope)
    expect(queries[0].sql).toContain('false')
  })

  it('refuses an operator it cannot reproduce rather than answer a different question', async () => {
    const { db } = recordingDb()
    await expect(computeTimeEntryTotals(db, { date: { $regex: '2026' } }, scope)).rejects.toThrow('unsupported filter operator')
    await expect(computeTimeEntryTotals(db, { cf_priority: 'high' }, scope)).rejects.toThrow('unsupported filter column')
  })

  it('returns zero totals without querying when no organization is in scope', async () => {
    const { db, queries } = recordingDb()
    const totals = await computeTimeEntryTotals(db, {}, { ...scope, organizationIds: [], canSeeRates: true })
    expect(totals).toEqual({ entryCount: 0, durationMinutes: 0, roundedMinutes: 0, money: [] })
    expect(queries).toHaveLength(0)
  })

  it('adds per-currency money only for a caller who may see rates, priced like the row cost', async () => {
    const { db, queries } = recordingDb((query) =>
      query.sql.includes('currency_code')
        ? [
            { currency_code: 'EUR', amount: '200.00' },
            { currency_code: 'PLN', amount: '4315.50' },
          ]
        : [{ entry_count: '3', duration_minutes: '120', rounded_minutes: '135' }],
    )
    const totals = await computeTimeEntryTotals(db, {}, { ...scope, canSeeRates: true })

    expect(totals.money).toEqual([
      { currencyCode: 'EUR', amount: 200 },
      { currencyCode: 'PLN', amount: 4315.5 },
    ])
    expect(queries).toHaveLength(2)
    const moneySql = queries[1].sql
    expect(moneySql).toContain('left join "staff_time_projects" as "p"')
    expect(moneySql).toContain('"p"."deleted_at" is null')
    expect(moneySql).toContain('"e"."is_billable" = $')
    expect(moneySql).toContain('round(coalesce(e.rounded_minutes, 0)::numeric / 60 * coalesce(e.rate_override_amount, p.hourly_rate), 2)')
    expect(moneySql).toContain("group by coalesce(nullif(trim(e.rate_currency_code), ''), p.currency_code)")
  })

  it('never queries money for a caller without the rates feature', async () => {
    const { db, queries } = recordingDb()
    const totals = await computeTimeEntryTotals(db, {}, scope)
    expect(totals).not.toHaveProperty('money')
    expect(queries).toHaveLength(1)
  })

  it('counts soft-deleted entries only when the list itself includes them', async () => {
    const live = recordingDb()
    await computeTimeEntryTotals(live.db, {}, scope)
    expect(live.queries[0].sql).toContain('"e"."deleted_at" is null')

    const withDeleted = recordingDb()
    await computeTimeEntryTotals(withDeleted.db, {}, { ...scope, includeDeleted: true })
    expect(withDeleted.queries[0].sql).not.toContain('deleted_at')
  })
})
