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

describe('BasicQueryEngine — list COUNT query (issue #2227)', () => {
  test('uses count(*) and no group-by when no joins can multiply base rows', async () => {
    const selects: any[] = []
    const fakeDb = createFakeKysely(selects)
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', { tenantId: 't1', fields: ['id'], page: { page: 1, pageSize: 20 } })

    const countSql = findCountSql(selects)
    expect(countSql).toContain('count(*)')
    expect(countSql).not.toContain('distinct')

    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'scheduled_jobs')
    expect(baseCall._ops.groups.length).toBe(0)
  })

  test('keeps count(distinct base.id) with group-by when extensions are joined', async () => {
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
    expect(countSql).toContain('count(distinct')
    expect(countSql).not.toContain('count(*)')

    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'users')
    expect(baseCall._ops.groups.length).toBeGreaterThan(0)
  })

  test('keeps count(distinct base.id) without group-by when an explicit relation join is configured', async () => {
    const selects: any[] = []
    const fakeDb = createFakeKysely(selects)
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('scheduler:scheduled_job', {
      tenantId: 't1',
      fields: ['id'],
      joins: [{ alias: 'owner', table: 'users', from: { field: 'owner_id' }, to: { field: 'id' } }],
      page: { page: 1, pageSize: 20 },
    })

    const countSql = findCountSql(selects)
    expect(countSql).toContain('count(distinct')
    expect(countSql).not.toContain('count(*)')

    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'scheduled_jobs')
    expect(baseCall._ops.groups.length).toBe(0)
  })
})
