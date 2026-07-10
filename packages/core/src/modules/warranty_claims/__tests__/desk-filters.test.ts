import type { EntityManager } from '@mikro-orm/postgresql'
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely'
import {
  SLA_AT_RISK_DEFAULT_THRESHOLD_PCT,
  SLA_AT_RISK_EXCLUDED_STATUSES,
  SLA_AT_RISK_MATCH_LIMIT,
  applySlaAtRiskConditions,
  buildDateRangeFilter,
  findSlaAtRiskClaimIds,
  narrowFiltersToClaimIds,
  normalizeSlaAtRiskThresholdPct,
  type WarrantyClaimsSlaDb,
} from '../lib/deskFilters'

const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'

function createRecordingDb(rows: unknown[] = []): { db: Kysely<WarrantyClaimsSlaDb>; queries: CompiledQuery[] } {
  const queries: CompiledQuery[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(compiledQuery)
      return { rows: rows as R[] }
    },
    async *streamQuery() {
      throw new Error('[internal] streamQuery is not supported in tests')
    },
  }
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  }
  const db = new Kysely<WarrantyClaimsSlaDb>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (innerDb) => new PostgresIntrospector(innerDb),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  return { db, queries }
}

function fakeEm(db: Kysely<WarrantyClaimsSlaDb>): EntityManager {
  return { getKysely: () => db } as unknown as EntityManager
}

describe('normalizeSlaAtRiskThresholdPct', () => {
  it('passes finite percentages through and clamps to [0, 100]', () => {
    expect(normalizeSlaAtRiskThresholdPct(75)).toBe(75)
    expect(normalizeSlaAtRiskThresholdPct(0)).toBe(0)
    expect(normalizeSlaAtRiskThresholdPct(250)).toBe(100)
    expect(normalizeSlaAtRiskThresholdPct(-5)).toBe(0)
  })

  it('falls back to the default for non-finite input', () => {
    expect(normalizeSlaAtRiskThresholdPct(Number.NaN)).toBe(SLA_AT_RISK_DEFAULT_THRESHOLD_PCT)
    expect(normalizeSlaAtRiskThresholdPct('not-a-number')).toBe(SLA_AT_RISK_DEFAULT_THRESHOLD_PCT)
    expect(normalizeSlaAtRiskThresholdPct(undefined)).toBe(SLA_AT_RISK_DEFAULT_THRESHOLD_PCT)
  })
})

describe('applySlaAtRiskConditions', () => {
  const now = new Date('2026-07-10T12:00:00.000Z')

  function compile(thresholdPct: number) {
    const { db } = createRecordingDb()
    return applySlaAtRiskConditions(db.selectFrom('warranty_claims').select('id'), thresholdPct, now).compile()
  }

  it('mirrors the stats-route at-risk predicate: approaching but not overdue, not paused, submitted, tracked status', () => {
    const compiled = compile(50)
    expect(compiled.sql).toContain('"sla_due_at" >')
    expect(compiled.sql).toContain('"sla_paused_at" is null')
    expect(compiled.sql).toContain('"status" not in')
    expect(compiled.sql).toContain('"submitted_at" is not null')
    expect(compiled.sql).toContain('sla_due_at > submitted_at')
    expect(compiled.sql).toContain('extract(epoch from')
    expect(compiled.sql).toContain('* 100 >= extract(epoch from (sla_due_at - submitted_at)) *')
    expect(compiled.parameters).toContain(50)
    for (const status of SLA_AT_RISK_EXCLUDED_STATUSES) {
      expect(compiled.parameters).toContain(status)
    }
    expect(compiled.parameters.filter((param) => param instanceof Date && param.getTime() === now.getTime()).length)
      .toBeGreaterThanOrEqual(2)
  })

  it('normalizes out-of-range thresholds before binding', () => {
    expect(compile(250).parameters).toContain(100)
    expect(compile(-1).parameters).toContain(0)
    expect(compile(Number.NaN).parameters).toContain(SLA_AT_RISK_DEFAULT_THRESHOLD_PCT)
  })
})

describe('findSlaAtRiskClaimIds', () => {
  const now = new Date('2026-07-10T12:00:00.000Z')

  it('scopes by tenant, soft-delete, selected organization, and match limit, returning the row ids', async () => {
    const { db, queries } = createRecordingDb([{ id: UUID_A }, { id: UUID_B }])
    const ids = await findSlaAtRiskClaimIds(
      fakeEm(db),
      { tenantId: 'tenant-1', selectedOrganizationId: 'org-1', visibleOrganizationIds: ['org-1', 'org-2'] },
      75,
      now,
    )
    expect(ids).toEqual([UUID_A, UUID_B])
    expect(queries).toHaveLength(1)
    const compiled = queries[0]
    expect(compiled.sql).toContain('"tenant_id" =')
    expect(compiled.sql).toContain('"deleted_at" is null')
    expect(compiled.sql).toContain('"organization_id" =')
    expect(compiled.sql).not.toContain('"organization_id" in')
    expect(compiled.sql).toContain(`limit $`)
    expect(compiled.parameters).toContain('tenant-1')
    expect(compiled.parameters).toContain('org-1')
    expect(compiled.parameters).toContain(SLA_AT_RISK_MATCH_LIMIT)
  })

  it('falls back to visible organization ids when no single organization is selected', async () => {
    const { db, queries } = createRecordingDb([])
    await findSlaAtRiskClaimIds(
      fakeEm(db),
      { tenantId: 'tenant-1', selectedOrganizationId: null, visibleOrganizationIds: ['org-1', 'org-2'] },
      75,
      now,
    )
    const compiled = queries[0]
    expect(compiled.sql).toContain('"organization_id" in')
    expect(compiled.parameters).toContain('org-1')
    expect(compiled.parameters).toContain('org-2')
  })

  it('omits the organization clause when the caller scope is tenant-wide', async () => {
    const { db, queries } = createRecordingDb([])
    await findSlaAtRiskClaimIds(
      fakeEm(db),
      { tenantId: 'tenant-1', selectedOrganizationId: null, visibleOrganizationIds: null },
      75,
      now,
    )
    expect(queries[0].sql).not.toContain('"organization_id"')
  })
})

describe('narrowFiltersToClaimIds', () => {
  it('installs a guaranteed-empty match when no ids are provided', () => {
    const filters: Record<string, unknown> = { status: { $in: ['submitted'] } }
    narrowFiltersToClaimIds(filters, [])
    expect(filters.id).toEqual({ $eq: NO_MATCH_ID })
    expect(filters.status).toEqual({ $in: ['submitted'] })
  })

  it('installs an $in filter when no id narrowing exists yet', () => {
    const filters: Record<string, unknown> = {}
    narrowFiltersToClaimIds(filters, [UUID_A, UUID_B])
    expect(filters.id).toEqual({ $in: [UUID_A, UUID_B] })
  })

  it('intersects with an existing $eq narrowing', () => {
    const filters: Record<string, unknown> = { id: { $eq: UUID_A } }
    narrowFiltersToClaimIds(filters, [UUID_A, UUID_B])
    expect(filters.id).toEqual({ $in: [UUID_A] })
  })

  it('intersects with an existing $in narrowing', () => {
    const filters: Record<string, unknown> = { id: { $in: [UUID_A, UUID_C] } }
    narrowFiltersToClaimIds(filters, [UUID_C, UUID_B])
    expect(filters.id).toEqual({ $in: [UUID_C] })
  })

  it('degrades a disjoint intersection to a guaranteed-empty match instead of an invalid empty $in', () => {
    const filters: Record<string, unknown> = { id: { $in: [UUID_A] } }
    narrowFiltersToClaimIds(filters, [UUID_B])
    expect(filters.id).toEqual({ $eq: NO_MATCH_ID })
  })
})

describe('buildDateRangeFilter', () => {
  it('builds inclusive UTC day boundaries', () => {
    const range = buildDateRangeFilter('2026-07-01', '2026-07-10')
    expect(range).toEqual({
      $gte: new Date('2026-07-01T00:00:00.000Z'),
      $lte: new Date('2026-07-10T23:59:59.999Z'),
    })
  })

  it('supports open-ended ranges', () => {
    expect(buildDateRangeFilter('2026-07-01', undefined)).toEqual({ $gte: new Date('2026-07-01T00:00:00.000Z') })
    expect(buildDateRangeFilter(undefined, '2026-07-10')).toEqual({ $lte: new Date('2026-07-10T23:59:59.999Z') })
  })

  it('returns null when both bounds are missing or invalid', () => {
    expect(buildDateRangeFilter(undefined, undefined)).toBeNull()
    expect(buildDateRangeFilter('2026-02-30', undefined)).toBeNull()
    expect(buildDateRangeFilter('not-a-date', undefined)).toBeNull()
  })
})
