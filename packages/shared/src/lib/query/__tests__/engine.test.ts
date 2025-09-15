import { BasicQueryEngine } from '../engine'

// Mock modules with one entity extension
jest.mock('@/generated/modules.generated', () => ({
  modules: [
    { id: 'auth', entityExtensions: [ { base: 'auth:user', extension: 'my_module:user_profile', join: { baseKey: 'id', extensionKey: 'user_id' } } ] },
  ],
}))

function createFakeKnex() {
  const calls: any[] = []
  const data: Record<string, any[]> = {
    custom_field_defs: [{ key: 'vip' }, { key: 'industry' }],
  }
  function raw(sql: string, params?: any[]) { return { toString: () => sql, sql, params } }
  function builderFor(table: string) {
    const ops = { table, wheres: [] as any[], joins: [] as any[], selects: [] as any[], orderBys: [] as any[], groups: [] as any[], limits: 0, offsets: 0 }
    const b: any = {
      _ops: ops,
      select: function (...cols: any[]) { ops.selects.push(cols); return this },
      where: function (...args: any[]) { ops.wheres.push(args); return this },
      andWhere: function (...args: any[]) { ops.wheres.push(args); return this },
      whereIn: function (...args: any[]) { ops.wheres.push(['in', ...args]); return this },
      whereNotIn: function (...args: any[]) { ops.wheres.push(['notIn', ...args]); return this },
      whereNull: function (col: any) { ops.wheres.push(['isNull', col]); return this },
      whereNotNull: function (col: any) { ops.wheres.push(['notNull', col]); return this },
      leftJoin: function (aliasObj: any, fn: Function) {
        ops.joins.push({ aliasObj })
        const ctx: any = {
          on: () => ({ andOn: () => ctx }),
          andOn: () => ctx,
        }
        fn.call(ctx)
        return this
      },
      orderBy: function (col: any, dir?: any) { ops.orderBys.push([col, dir]); return this },
      groupBy: function (col: any) { ops.groups.push(col); return this },
      limit: function (n: number) { ops.limits = n; return this },
      offset: function (n: number) { ops.offsets = n; return this },
      clone: function () { return this },
      countDistinct: async function () { return [{ count: '0' }] },
      count: async function () { return [{ count: '0' }] },
      first: async function () { const rows = data[table] || []; return rows[0] },
      modify: function (fn: Function) { fn({ andWhere: (obj: any) => ops.wheres.push(['andWhere', obj]) }); return this },
      then: function (resolve: any) { const res = data[table] || []; return Promise.resolve(resolve(res)) },
    }
    calls.push(b)
    return b
  }
  const fn: any = (table: string) => builderFor(table)
  fn.raw = raw
  fn._calls = calls
  return fn
}

describe('BasicQueryEngine', () => {
  test('includeCustomFields true discovers keys and allows sort on cf:*; joins extensions', async () => {
    const fakeKnex = createFakeKnex()
    const engine = new BasicQueryEngine({} as any, () => fakeKnex as any)
    const res = await engine.query('auth:user', {
      includeCustomFields: true,
      fields: ['id','email','cf:vip'],
      sort: [{ field: 'cf:vip', dir: 'asc' }],
      includeExtensions: true,
      organizationId: 1,
      page: { page: 1, pageSize: 10 },
    })
    expect(res).toMatchObject({ page: 1, pageSize: 10, total: 0, items: [] })
    // Assert that custom_field_defs was queried for this entity and org
    const defsCall = fakeKnex._calls.find((b: any) => b._ops.table === 'custom_field_defs')
    expect(defsCall).toBeTruthy()
    const hasEntityFilter = defsCall._ops.wheres.some((w: any) => JSON.stringify(w).includes('entity_id'))
    expect(hasEntityFilter).toBe(true)
    const hasOrgFilter = defsCall._ops.wheres.some((w: any) => JSON.stringify(w).includes('organization_id'))
    expect(hasOrgFilter).toBe(true)
    // Assert base ordering by cf alias was recorded
    const baseCall = fakeKnex._calls.find((b: any) => b._ops.table === 'users')
    const hasCfOrder = baseCall._ops.orderBys.some((o: any) => o[0] === 'cf_vip')
    expect(hasCfOrder).toBe(true)
    // Assert an extension leftJoin was attempted
    const hasExtJoin = baseCall._ops.joins.length > 0
    expect(hasExtJoin).toBe(true)
  })
})
