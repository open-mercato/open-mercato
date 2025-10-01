import { HybridQueryEngine } from '../../query_index/lib/engine'

function createFakeKnex(config: {
  baseTable: string
  hasIndexAny: boolean
  baseCount: number
  indexCount: number
}) {
  const calls: any[] = []
  function raw(sql: string, params?: any[]) { return { toString: () => sql, sql, params } }
  function normalizeTable(t: any): { table: string; alias?: string } {
    if (typeof t === 'string') return { table: t }
    if (t && typeof t === 'object') {
      const alias = Object.keys(t)[0]
      const table = (t as any)[alias]
      return { table, alias }
    }
    return { table: String(t) }
  }
  function builderFor(tableArg: any) {
    const { table, alias } = normalizeTable(tableArg)
    const ops = { table, alias, wheres: [] as any[], joins: [] as any[], selects: [] as any[], orderBys: [] as any[], limits: 0, offsets: 0, isCountDistinct: false }
    const b: any = {
      _ops: ops,
      select: function (...cols: any[]) { ops.selects.push(cols); return this },
      where: function (...args: any[]) { ops.wheres.push(args); return this },
      andWhere: function (...args: any[]) { ops.wheres.push(args); return this },
      whereIn: function (...args: any[]) { ops.wheres.push(['in', ...args]); return this },
      whereNotIn: function (...args: any[]) { ops.wheres.push(['notIn', ...args]); return this },
      whereNull: function (col: any) { ops.wheres.push(['isNull', col]); return this },
      whereNotNull: function (col: any) { ops.wheres.push(['notNull', col]); return this },
      leftJoin: function (aliasObj: any, on: any) { ops.joins.push({ aliasObj, on }); return this },
      orderBy: function (col: any, dir?: any) { ops.orderBys.push([col, dir]); return this },
      limit: function (n: number) { ops.limits = n; return this },
      offset: function (n: number) { ops.offsets = n; return this },
      groupBy: function () { return this },
      clearSelect: function () { ops.selects = []; return this },
      clearOrder: function () { ops.orderBys = []; return this },
      clone: function () { return this },
      countDistinct: function () { ops.isCountDistinct = true; return this },
      first: async function () {
        // Handle information_schema and index existence checks
        if (table === 'information_schema.tables') {
          const baseExists = { table_name: config.baseTable }
          return baseExists
        }
        if (table === 'entity_indexes' && !ops.isCountDistinct) {
          return config.hasIndexAny ? { entity_type: 'x' } : undefined
        }
        if (ops.isCountDistinct) {
          if (table === config.baseTable || ops.alias === 'b') return { count: String(config.baseCount) }
          if (table === 'entity_indexes' || ops.alias === 'ei') return { count: String(config.indexCount) }
          return { count: '0' }
        }
        return undefined
      },
      then: function (resolve: any) { return Promise.resolve(resolve([])) },
      raw,
    }
    calls.push(b)
    return b
  }
  const fn: any = (t: any) => builderFor(t)
  fn.raw = raw
  fn._calls = calls
  return fn
}

describe('HybridQueryEngine', () => {
  test('falls back when wantsCf but no index rows exist', async () => {
    const fakeKnex = createFakeKnex({ baseTable: 'todos', hasIndexAny: false, baseCount: 5, indexCount: 0 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }) }
    const engine = new HybridQueryEngine(em, fallback as any)

    await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1' })
    expect(fallback.query).toHaveBeenCalled()
  })

  test('falls back and warns on partial coverage', async () => {
    const fakeKnex = createFakeKnex({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 1 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }) }
    const engine = new HybridQueryEngine(em, fallback as any)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1' })
    expect(fallback.query).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    const msg = (warnSpy.mock.calls[0] || [])[0] as string
    expect(msg).toContain('Partial index coverage')
    warnSpy.mockRestore()
  })

  test('uses hybrid path when coverage complete', async () => {
    const fakeKnex = createFakeKnex({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 10 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn() }
    const engine = new HybridQueryEngine(em, fallback as any)

    await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', page: { page: 1, pageSize: 5 } })
    expect(fallback.query).not.toHaveBeenCalled()
  })
})

