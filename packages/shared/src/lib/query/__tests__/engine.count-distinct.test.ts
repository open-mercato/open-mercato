import { BasicQueryEngine } from '../engine'
import { registerModules } from '../../i18n/server'

// One entity extension on auth:user so includeExtensions exercises the joined-aggregate path.
registerModules([
  { id: 'auth', entityExtensions: [{ base: 'auth:user', extension: 'my_module:user_profile', join: { baseKey: 'id', extensionKey: 'user_id' } }] },
] as any)

type FakeData = Record<string, any[]>

function cloneRows(rows: any[] | undefined): any[] {
  if (!rows) return []
  return rows.map((row) => ({ ...row }))
}

// Reads the SQL text of a Kysely raw/aliased expression by walking its operation node.
function rawSqlText(expr: any): string {
  const node = typeof expr?.toOperationNode === 'function' ? expr.toOperationNode() : expr
  const inner = node?.node ?? node
  const fragments = inner?.sqlFragments
  return Array.isArray(fragments) ? fragments.join(' ? ') : ''
}

function aliasName(expr: any): string | undefined {
  const node = typeof expr?.toOperationNode === 'function' ? expr.toOperationNode() : expr
  const alias = node?.alias
  return alias?.name ?? alias?.column?.name
}

function createFakeKysely(selectsSink: any[], overrides?: FakeData) {
  const calls: any[] = []
  const defaultData: FakeData = { custom_field_defs: [], custom_field_values: [] }
  const sourceData = { ...defaultData, ...(overrides || {}) }
  const data: FakeData = Object.fromEntries(
    Object.entries(sourceData).map(([table, rows]) => [table, cloneRows(rows)]),
  )

  function parseTableSpec(spec: unknown): { table: string; alias: string | null } {
    if (typeof spec !== 'string') return { table: String(spec || ''), alias: null }
    const asMatch = /^(.+?)\s+as\s+(.+)$/i.exec(spec)
    if (asMatch) return { table: asMatch[1].trim(), alias: asMatch[2].trim() }
    return { table: spec, alias: null }
  }

  function createExpressionBuilder() {
    const eb: any = (column: any, op: any, value: any) => ({ kind: 'cmp', column, op, value })
    eb.and = (parts: any[]) => ({ kind: 'and', parts })
    eb.or = (parts: any[]) => ({ kind: 'or', parts })
    eb.not = (part: any) => ({ kind: 'not', part })
    eb.exists = (sub: any) => ({ kind: 'exists', sub })
    eb.val = (value: any) => ({ kind: 'val', value })
    eb.ref = (name: string) => ({ kind: 'ref', name })
    eb.selectFrom = (spec: any) => builderFor(spec)
    return eb
  }

  function normalizeWhereArgs(args: any[]): any[] {
    if (args.length === 1 && typeof args[0] === 'function') {
      const produced = args[0](createExpressionBuilder())
      if (produced && produced.kind === 'or') return ['or', produced.parts]
      if (produced && produced.kind === 'and') return ['and', produced.parts]
      if (produced && produced.kind === 'exists') return ['exists', produced.sub]
      if (produced && produced.kind === 'not' && produced.part?.kind === 'exists') return ['notExists', produced.part.sub]
      return ['expr', produced]
    }
    return args
  }

  function recordJoin(ops: any, type: 'left' | 'inner', spec: any, fn: Function) {
    const parsed = parseTableSpec(spec)
    const aliasObj = parsed.alias ? { [parsed.alias]: parsed.table } : { [parsed.table]: parsed.table }
    const entry: any = { type, aliasObj, conditions: [] as any[] }
    const ctx: any = {}
    ctx.on = (left: any, op?: any, right?: any) => {
      if (typeof left === 'function') entry.conditions.push({ method: 'on', expr: left(createExpressionBuilder()) })
      else entry.conditions.push({ method: 'on', args: [left, op, right] })
      return ctx
    }
    ctx.onRef = (left: any, op: any, right: any) => {
      entry.conditions.push({ method: 'on', args: [left, op, right] })
      return ctx
    }
    fn(ctx)
    ops.joins.push(entry)
  }

  function makeBuilder(ops: any, record: boolean): any {
    const b: any = {
      _ops: ops,
      select(this: any, ...cols: any[]) {
        const flat = cols.length === 1 && Array.isArray(cols[0]) ? cols[0] : cols
        this._ops.selects.push(...flat)
        selectsSink.push(...flat)
        return this
      },
      distinct(this: any) { return this },
      where(this: any, ...args: any[]) { this._ops.wheres.push(normalizeWhereArgs(args)); return this },
      whereRef(this: any, left: any, op: any, right: any) { this._ops.wheres.push(['ref', left, op, right]); return this },
      leftJoin(this: any, spec: any, fn: Function) { recordJoin(this._ops, 'left', spec, fn); return this },
      innerJoin(this: any, spec: any, fn: Function) { recordJoin(this._ops, 'inner', spec, fn); return this },
      groupBy(this: any, arg: any) {
        if (Array.isArray(arg)) this._ops.groups.push(...arg)
        else this._ops.groups.push(arg)
        return this
      },
      having(this: any) { return this },
      orderBy(this: any, col: any, dir?: any) { this._ops.orderBys.push([col, dir]); return this },
      limit(this: any, n: number) { this._ops.limits = n; return this },
      offset(this: any, n: number) { this._ops.offsets = n; return this },
      clearSelect(this: any) { return makeBuilder({ ...this._ops, selects: [] }, false) },
      clearOrderBy(this: any) { return makeBuilder({ ...this._ops, orderBys: [] }, false) },
      clearGroupBy(this: any) { return makeBuilder({ ...this._ops, groups: [] }, false) },
      as(this: any, alias: string) { this._ops.alias = alias; return this },
      async execute(this: any) { return cloneRows(data[this._ops.table]) },
      async executeTakeFirst(this: any) {
        const localOps = this._ops
        if (localOps.table === 'information_schema.columns') {
          const infoRows = data['information_schema.columns']
          if (!Array.isArray(infoRows)) return undefined
          const targetTable = extractEqValue(localOps.wheres, 'table_name')
          const targetColumn = extractEqValue(localOps.wheres, 'column_name')
          return infoRows.find((row: any) =>
            (!targetTable || row.table_name === targetTable) && (!targetColumn || row.column_name === targetColumn))
        }
        if (localOps.table === 'information_schema.tables') {
          const infoRows = data['information_schema.tables']
          if (!Array.isArray(infoRows)) return undefined
          const targetTable = extractEqValue(localOps.wheres, 'table_name')
          return infoRows.find((row: any) => !targetTable || row.table_name === targetTable)
        }
        if (localOps.selects.some((s: any) => aliasName(s) === 'count')) return { count: '0' }
        const rows = data[localOps.table] || []
        if (rows.length === 0) return { count: '0' }
        return rows[0]
      },
    }
    if (record) calls.push(b)
    return b
  }

  function builderFor(tableArg: any): any {
    if (tableArg && typeof tableArg === 'object' && tableArg._ops) {
      // selectFrom(subquery.as(alias)) — the capped-count probe shape.
      const ops = {
        table: '__subquery__',
        alias: tableArg._ops.alias ?? null,
        subquery: tableArg._ops,
        wheres: [] as any[],
        joins: [] as any[],
        selects: [] as any[],
        orderBys: [] as any[],
        groups: [] as any[],
        limits: 0,
        offsets: 0,
      }
      return makeBuilder(ops, true)
    }
    const parsed = parseTableSpec(tableArg)
    const ops = {
      table: parsed.table,
      alias: parsed.alias,
      wheres: [] as any[],
      joins: [] as any[],
      selects: [] as any[],
      orderBys: [] as any[],
      groups: [] as any[],
      limits: 0,
      offsets: 0,
    }
    return makeBuilder(ops, true)
  }

  function extractEqValue(wheres: any[], column: string): any {
    for (const entry of wheres) {
      if (!Array.isArray(entry)) continue
      if (entry[0] === column && entry[1] === '=') return entry[2]
    }
    return undefined
  }

  const db: any = { selectFrom(spec: any) { return builderFor(spec) } }
  db._calls = calls
  return db
}

function findCountSql(selectsSink: any[]): string {
  const countExprs = selectsSink.filter((s) => aliasName(s) === 'count')
  expect(countExprs.length).toBeGreaterThan(0)
  return rawSqlText(countExprs[countExprs.length - 1]).toLowerCase()
}

// The count query is rebuilt from scope + filters only (#4552 Phase 2): cf
// filters compile to correlated EXISTS semi-joins, projection joins are
// dropped, so the count never needs DISTINCT or GROUP BY — completing the
// direction #2227 started — and the LIMIT cap+1 probe actually bounds the scan.
describe('BasicQueryEngine — rebuilt list COUNT query (#4552 Phase 2)', () => {
  const originalCap = process.env.OM_LIST_COUNT_CAP
  afterEach(() => {
    if (originalCap === undefined) delete process.env.OM_LIST_COUNT_CAP
    else process.env.OM_LIST_COUNT_CAP = originalCap
  })

  // The count-shape builder is the base-table call carrying the probe LIMIT
  // (cap + 1); with the cap disabled it is the base call whose recorded select
  // is the bare count aggregate.
  function findCountShapeCall(fakeDb: any, table: string) {
    const baseCalls = fakeDb._calls.filter((b: any) => b._ops.table === table)
    const probed = baseCalls.find((b: any) => b._ops.limits === 10_001)
    if (probed) return probed
    return baseCalls.find((b: any) => b._ops.selects.some((s: any) => aliasName(s) === 'count'))
  }

  test('uses count(*) with no DISTINCT and no GROUP BY when nothing joins', async () => {
    const selects: any[] = []
    const fakeDb = createFakeKysely(selects)
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', { tenantId: 't1', fields: ['id'], page: { page: 1, pageSize: 20 } })

    const countSql = findCountSql(selects)
    expect(countSql).toContain('count(*)')
    expect(countSql).not.toContain('distinct')

    const countCall = findCountShapeCall(fakeDb, 'scheduled_jobs')
    expect(countCall._ops.groups.length).toBe(0)
  })

  test('drops extension projection joins from the count: count(*) over the bare base table', async () => {
    const selects: any[] = []
    const fakeDb = createFakeKysely(selects)
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('auth:user', {
      tenantId: 't1',
      organizationId: '1',
      fields: ['id'],
      includeExtensions: true,
      page: { page: 1, pageSize: 20 },
    })

    const countSql = findCountSql(selects)
    expect(countSql).toContain('count(*)')
    expect(countSql).not.toContain('distinct')

    // The display query keeps the extension join + GROUP BY …
    const dataCall = fakeDb._calls.find((b: any) => b._ops.table === 'users' && b._ops.joins.length > 0)
    expect(dataCall._ops.groups.length).toBeGreaterThan(0)
    // … while the count shape carries neither: no join can multiply base rows,
    // so no barrier sits between the probe LIMIT and the scan.
    const countCall = findCountShapeCall(fakeDb, 'users')
    expect(countCall._ops.joins.length).toBe(0)
    expect(countCall._ops.groups.length).toBe(0)
  })

  test('explicit relation joins never reach the count: count(*), join filters stay EXISTS', async () => {
    const selects: any[] = []
    const fakeDb = createFakeKysely(selects)
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
      joins: [{ alias: 'owner', table: 'users', from: { field: 'owner_id' }, to: { field: 'id' } }],
      filters: { 'owner.email': { $eq: 'a@b.c' } },
      page: { page: 1, pageSize: 20 },
    })

    const countSql = findCountSql(selects)
    expect(countSql).toContain('count(*)')
    expect(countSql).not.toContain('distinct')

    const countCall = findCountShapeCall(fakeDb, 'scheduled_jobs')
    expect(countCall._ops.groups.length).toBe(0)
    expect(countCall._ops.joins.length).toBe(0)
    // The join filter is a semi-join on the count shape, not a join.
    expect(countCall._ops.wheres.some((w: any) => Array.isArray(w) && w[0] === 'exists')).toBe(true)
  })

  test('cf filters compile to EXISTS over custom_field_values on the count shape', async () => {
    const selects: any[] = []
    const fakeDb = createFakeKysely(selects, {
      custom_field_defs: [
        { key: 'color', entity_id: 'scheduler:scheduled_job', is_active: true, tenant_id: null, kind: 'text', config_json: '{}' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
      filters: { cf_color: { $eq: 'red' } },
      page: { page: 1, pageSize: 20 },
    })

    const countSql = findCountSql(selects)
    expect(countSql).toContain('count(*)')
    expect(countSql).not.toContain('distinct')

    const countCall = findCountShapeCall(fakeDb, 'scheduled_jobs')
    expect(countCall._ops.groups.length).toBe(0)
    // No custom_field_values join on the count shape — the filter is an EXISTS
    // whose subquery selects from custom_field_values.
    expect(countCall._ops.joins.length).toBe(0)
    const existsEntries = countCall._ops.wheres.filter((w: any) => Array.isArray(w) && w[0] === 'exists')
    expect(existsEntries.length).toBeGreaterThan(0)
    const existsSub = existsEntries[0][1]
    expect(existsSub._ops.table).toBe('custom_field_values')
    // The display query still resolves the same filter through its value join.
    const dataCall = fakeDb._calls.find((b: any) =>
      b._ops.table === 'scheduled_jobs' &&
      b._ops.joins.some((j: any) => Object.values(j.aliasObj).includes('custom_field_values')))
    expect(dataCall).toBeTruthy()
  })

  test('a cf leaf inside $or compiles to EXISTS on the count shape instead of being dropped (#5039)', async () => {
    const selects: any[] = []
    const fakeDb = createFakeKysely(selects, {
      custom_field_defs: [
        { key: 'color', entity_id: 'scheduler:scheduled_job', is_active: true, tenant_id: null, kind: 'text', config_json: '{}' },
      ],
      'information_schema.columns': [
        { table_name: 'scheduled_jobs', column_name: 'id' },
        { table_name: 'scheduled_jobs', column_name: 'tenant_id' },
        { table_name: 'scheduled_jobs', column_name: 'status' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
      filters: { $or: [{ status: { $eq: 'closed' } }, { cf_color: { $eq: 'red' } }] },
      page: { page: 1, pageSize: 20 },
    })

    const countCall = findCountShapeCall(fakeDb, 'scheduled_jobs')
    expect(countCall._ops.joins.length).toBe(0)
    // The whole disjunction lands in one OR where-entry whose parts include an
    // EXISTS (the cf leaf) — dropping it would narrow the OR and undercount.
    const orEntries = countCall._ops.wheres.filter((w: any) => Array.isArray(w) && w[0] === 'or')
    expect(orEntries.length).toBeGreaterThan(0)
    const hasExistsPart = orEntries.some((entry: any) =>
      (entry[1] ?? []).some((part: any) => part?.kind === 'exists' || (part?.kind === 'and' && part.parts?.some((p: any) => p?.kind === 'exists'))))
    expect(hasExistsPart).toBe(true)
  })

  test('the probe LIMIT is cap + 1 on the row-producing inner query, counted by an outer aggregate', async () => {
    process.env.OM_LIST_COUNT_CAP = '100'
    const selects: any[] = []
    const fakeDb = createFakeKysely(selects)
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', { tenantId: 't1', fields: ['id'], page: { page: 1, pageSize: 20 } })

    const outer = fakeDb._calls.find((b: any) => b._ops.table === '__subquery__')
    expect(outer).toBeTruthy()
    expect(outer._ops.subquery.limits).toBe(101)
    expect(outer._ops.subquery.groups.length).toBe(0)
    const countSql = findCountSql(selects)
    expect(countSql).toContain('count(*)')
  })

  test('OM_LIST_COUNT_CAP=0 disables the probe: a direct unbounded count(*)', async () => {
    process.env.OM_LIST_COUNT_CAP = '0'
    const selects: any[] = []
    const fakeDb = createFakeKysely(selects)
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    const result = await engine.query('scheduler:scheduled_job', { tenantId: 't1', fields: ['id'], page: { page: 1, pageSize: 20 } })

    expect(fakeDb._calls.some((b: any) => b._ops.table === '__subquery__')).toBe(false)
    const countSql = findCountSql(selects)
    expect(countSql).toContain('count(*)')
    expect(result.meta?.listCountCapWarning).toBeUndefined()
  })
})
