import { BasicQueryEngine } from '../engine'
import { normalizeFilters } from '../join-utils'

type FakeData = Record<string, any[]>

function cloneRows(rows: any[] | undefined): any[] {
  if (!rows) return []
  return rows.map((row) => ({ ...row }))
}

function createFakeKnex(overrides?: FakeData) {
  const calls: any[] = []
  const defaultData: FakeData = { custom_field_defs: [], custom_field_values: [] }
  const sourceData = { ...defaultData, ...(overrides || {}) }
  const data: FakeData = Object.fromEntries(
    Object.entries(sourceData).map(([table, rows]) => [table, cloneRows(rows)]),
  )
  function raw(sql: string, params?: any[]) {
    return { toString: () => sql, sql, params }
  }
  function makeBuilder(table: string) {
    const ops: any = {
      table,
      wheres: [] as any[],
      joins: [] as any[],
      selects: [] as any[],
      orderBys: [] as any[],
      groups: [] as any[],
      limits: 0,
      offsets: 0,
      isCountDistinct: false,
    }
    const b: any = {
      _ops: ops,
      select: function (...cols: any[]) { ops.selects.push(cols); return this },
      where: function (...args: any[]) {
        if (args.length === 1 && typeof args[0] === 'function') {
          const nested = makeBuilder(`${table}::where-fn`)
          args[0].call(nested, nested)
          ops.wheres.push(['whereFn', nested._ops])
          return this
        }
        ops.wheres.push(args)
        return this
      },
      andWhere: function (...args: any[]) { ops.wheres.push(['and', ...args]); return this },
      orWhere: function (...args: any[]) {
        if (args.length === 1 && typeof args[0] === 'function') {
          const nested = makeBuilder(`${table}::orWhere-fn`)
          args[0].call(nested, nested)
          ops.wheres.push(['orWhereFn', nested._ops])
          return this
        }
        ops.wheres.push(['orWhere', ...args])
        return this
      },
      whereIn: function (...args: any[]) { ops.wheres.push(['in', ...args]); return this },
      whereNotIn: function (...args: any[]) { ops.wheres.push(['notIn', ...args]); return this },
      whereNull: function (col: any) { ops.wheres.push(['isNull', col]); return this },
      whereNotNull: function (col: any) { ops.wheres.push(['notNull', col]); return this },
      whereExists: function (sub: any) { ops.wheres.push(['exists', sub]); return this },
      whereNotExists: function (sub: any) { ops.wheres.push(['notExists', sub]); return this },
      whereRaw: function (...args: any[]) { ops.wheres.push(['raw', ...args]); return this },
      orWhereNull: function (col: any) { ops.wheres.push(['orIsNull', col]); return this },
      leftJoin: function () { return this },
      join: function () { return this },
      orderBy: function (col: any, dir?: any) { ops.orderBys.push([col, dir]); return this },
      groupBy: function (col: any) { ops.groups.push(col); return this },
      limit: function (n: number) { ops.limits = n; return this },
      offset: function (n: number) { ops.offsets = n; return this },
      clone: function () { return this },
      countDistinct: function () { ops.isCountDistinct = true; return this },
      count: async function () { return [{ count: '0' }] },
      first: async function () { return ops.isCountDistinct ? { count: '0' } : (data[table] || [])[0] },
      modify: function () { return this },
      then: function (resolve: any) { return Promise.resolve(resolve(data[table] || [])) },
    }
    calls.push(b)
    return b
  }
  const fn: any = (tableArg: any) => {
    const t = typeof tableArg === 'string' ? tableArg : String(Object.values(tableArg || {})[0] || '')
    return makeBuilder(t)
  }
  fn.raw = raw
  fn._calls = calls
  return fn
}

function collectAllWheres(calls: any[]): any[] {
  const out: any[] = []
  for (const c of calls) out.push(...c._ops.wheres)
  return out
}

describe('normalizeFilters $or clause grouping', () => {
  test('assigns a distinct orGroup id per clause so multi-field clauses AND internally', () => {
    const normalized = normalizeFilters({
      $or: [
        { organization_id: { $eq: 'org-1' }, tenant_id: { $eq: 't1' } },
        { organization_id: { $eq: null }, tenant_id: { $eq: 't1' }, scope_type: { $eq: 'tenant' } },
      ],
    })

    const groups = new Set(normalized.map((f) => f.orGroup))
    expect(groups.size).toBe(2)

    const byGroup = new Map<string, typeof normalized>()
    for (const f of normalized) {
      const key = f.orGroup!
      const list = byGroup.get(key) ?? []
      list.push(f)
      byGroup.set(key, list)
    }

    const groupFields = Array.from(byGroup.values()).map((group) => group.map((f) => f.field).sort())
    expect(groupFields).toEqual(
      expect.arrayContaining([
        ['organization_id', 'tenant_id'].sort(),
        ['organization_id', 'scope_type', 'tenant_id'].sort(),
      ]),
    )
  })

  test('top-level non-$or filters remain un-grouped (ANDed) alongside $or disjuncts', () => {
    const normalized = normalizeFilters({
      $or: [{ a: 1 }, { b: 2 }],
      is_enabled: true,
    })
    const withoutGroup = normalized.filter((f) => !f.orGroup).map((f) => f.field)
    const withGroup = normalized.filter((f) => f.orGroup).map((f) => f.field)
    expect(withoutGroup).toEqual(['is_enabled'])
    expect(withGroup.sort()).toEqual(['a', 'b'])
  })
})

describe('BasicQueryEngine — null equality', () => {
  test('$eq null compiles to whereNull', async () => {
    const fakeKnex = createFakeKnex({
      scheduled_jobs: [],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'organization_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeKnex as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
      omitAutomaticTenantOrgScope: true,
      filters: { organization_id: { $eq: null } },
    })
    const wheres = collectAllWheres(fakeKnex._calls)
    const hasWhereNullOrgId = wheres.some(
      (w: any) => Array.isArray(w) && w[0] === 'isNull' && String(w[1]).endsWith('organization_id'),
    )
    expect(hasWhereNullOrgId).toBe(true)
    const hasEqualsLiteralNull = wheres.some(
      (w: any) => Array.isArray(w) && w.length >= 2 && String(w[0]).endsWith('organization_id') && w[1] === null,
    )
    expect(hasEqualsLiteralNull).toBe(false)
  })

  test('$ne null compiles to whereNotNull', async () => {
    const fakeKnex = createFakeKnex({
      scheduled_jobs: [],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'organization_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeKnex as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
      omitAutomaticTenantOrgScope: true,
      filters: { organization_id: { $ne: null } },
    })
    const wheres = collectAllWheres(fakeKnex._calls)
    const hasWhereNotNullOrgId = wheres.some(
      (w: any) => Array.isArray(w) && w[0] === 'notNull' && String(w[1]).endsWith('organization_id'),
    )
    expect(hasWhereNotNullOrgId).toBe(true)
  })
})

describe('BasicQueryEngine — omitAutomaticTenantOrgScope', () => {
  test('skips automatic tenant and organization guards when flag is set', async () => {
    const fakeKnex = createFakeKnex({
      scheduled_jobs: [],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'organization_id' },
        { table_name: 'scheduled_jobs', column_name: 'tenant_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeKnex as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      organizationId: 'org-1',
      fields: ['id'],
      omitAutomaticTenantOrgScope: true,
      filters: { id: { $eq: '11111111-1111-1111-1111-111111111111' } },
    })
    const baseCall = fakeKnex._calls.find((b: any) => b._ops.table === 'scheduled_jobs')
    expect(baseCall).toBeTruthy()
    const serialized = JSON.stringify(baseCall._ops.wheres)
    expect(serialized).not.toMatch(/organization_id.*org-1/)
    expect(serialized).not.toMatch(/\["scheduled_jobs\.tenant_id","t1"\]/)
  })

  test('applies automatic tenant guard when flag is absent (baseline)', async () => {
    const fakeKnex = createFakeKnex({
      scheduled_jobs: [],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'tenant_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeKnex as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
    })
    const baseCall = fakeKnex._calls.find((b: any) => b._ops.table === 'scheduled_jobs')
    const serialized = JSON.stringify(baseCall._ops.wheres)
    expect(serialized).toMatch(/tenant_id/)
    expect(serialized).toMatch(/t1/)
  })
})

describe('BasicQueryEngine — multi-field $or grouping', () => {
  test('AND within each $or clause, OR between clauses', async () => {
    const fakeKnex = createFakeKnex({
      scheduled_jobs: [],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'organization_id' },
        { table_name: 'scheduled_jobs', column_name: 'tenant_id' },
        { table_name: 'scheduled_jobs', column_name: 'scope_type' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeKnex as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
      omitAutomaticTenantOrgScope: true,
      filters: {
        $or: [
          { organization_id: { $eq: 'org-1' }, tenant_id: { $eq: 't1' } },
          { organization_id: { $eq: null }, tenant_id: { $eq: null }, scope_type: { $eq: 'system' } },
        ],
      },
    })
    const baseCall = fakeKnex._calls.find((b: any) => b._ops.table === 'scheduled_jobs')
    expect(baseCall).toBeTruthy()
    const whereFn = baseCall._ops.wheres.find((w: any) => Array.isArray(w) && w[0] === 'whereFn')
    expect(whereFn).toBeTruthy()
    const nestedOps = whereFn[1]
    const nestedWheres = nestedOps.wheres
    const orWhereFn = nestedWheres.find((w: any) => Array.isArray(w) && w[0] === 'orWhereFn')
    expect(orWhereFn).toBeTruthy()
    const firstGroupWheres = nestedWheres.filter((w: any) => !Array.isArray(w) || w[0] !== 'orWhereFn')
    const firstGroupColumns = firstGroupWheres
      .map((w: any) => (Array.isArray(w) ? String(w[0]) : ''))
      .filter((col: string) => col.endsWith('organization_id') || col.endsWith('tenant_id'))
    expect(firstGroupColumns.length).toBeGreaterThanOrEqual(2)
    const secondGroupOps = orWhereFn[1]
    const secondGroupWheres = secondGroupOps.wheres
    const hasSystemScopeFilter = secondGroupWheres.some(
      (w: any) => Array.isArray(w) && String(w[0]).endsWith('scope_type') && w[1] === 'system',
    )
    const hasNullOrgInSecondGroup = secondGroupWheres.some(
      (w: any) => Array.isArray(w) && w[0] === 'isNull' && String(w[1]).endsWith('organization_id'),
    )
    const hasNullTenantInSecondGroup = secondGroupWheres.some(
      (w: any) => Array.isArray(w) && w[0] === 'isNull' && String(w[1]).endsWith('tenant_id'),
    )
    expect(hasSystemScopeFilter).toBe(true)
    expect(hasNullOrgInSecondGroup).toBe(true)
    expect(hasNullTenantInSecondGroup).toBe(true)
  })
})
