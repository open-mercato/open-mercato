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
    const ops = { table, wheres: [] as any[], joins: [] as any[], selects: [] as any[], orderBys: [] as any[], groups: [] as any[], limits: 0, offsets: 0, isCountDistinct: false }
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
      countDistinct: function () { ops.isCountDistinct = true; return this },
      count: async function () { return [{ count: '0' }] },
      first: async function () { 
        // If this is called after countDistinct, return count data
        if (ops.isCountDistinct) {
          return { count: '0' }
        }
        const rows = data[table] || []; 
        return rows[0] 
      },
      modify: function (fn: Function) {
        const qb: any = {
          andWhere: (arg: any) => {
            if (typeof arg === 'function') {
              const inner: any = {
                where: (obj: any) => ({
                  orWhereNull: (col: any) => { ops.wheres.push(['andWhereFn', obj, ['orWhereNull', col]]); return inner },
                }),
              }
              arg(inner)
            } else {
              ops.wheres.push(['andWhere', arg])
            }
            return qb
          },
          whereNull: (col: any) => { ops.wheres.push(['isNull', col]); return qb },
        }
        fn(qb)
        return this
      },
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
  test('pluralizes entity names ending with y correctly', async () => {
    const fakeKnex = createFakeKnex()
    const engine = new BasicQueryEngine({} as any, () => fakeKnex as any)
    await engine.query('customers:customer_entity', { tenantId: 't1' })
    const baseCall = fakeKnex._calls.find((b: any) => b._ops.table === 'customer_entities')
    expect(baseCall).toBeTruthy()
  })

  test('includeCustomFields true discovers keys and allows sort on cf:*; joins extensions', async () => {
    const fakeKnex = createFakeKnex()
    const engine = new BasicQueryEngine({} as any, () => fakeKnex as any)
    const res = await engine.query('auth:user', {
      includeCustomFields: true,
      fields: ['id','email','cf:vip'],
      sort: [{ field: 'cf:vip', dir: 'asc' }],
      includeExtensions: true,
      organizationId: 1,
      tenantId: 't1',
      page: { page: 1, pageSize: 10 },
    })
    expect(res).toMatchObject({ page: 1, pageSize: 10, total: 0, items: [] })
    // Assert that custom_field_defs was queried for this entity and org
    const defsCall = fakeKnex._calls.find((b: any) => b._ops.table === 'custom_field_defs')
    expect(defsCall).toBeTruthy()
    const hasEntityFilter = defsCall._ops.wheres.some((w: any) => JSON.stringify(w).includes('entity_id'))
    expect(hasEntityFilter).toBe(true)
    // Organization-level scoping is intentionally disabled for custom field definitions; ensure tenant filter is present
    const hasTenantFilter = defsCall._ops.wheres.some((w: any) => JSON.stringify(w).includes('tenant_id'))
    expect(hasTenantFilter).toBe(true)
    // Assert base ordering by cf alias was recorded
    const baseCall = fakeKnex._calls.find((b: any) => b._ops.table === 'users')
    const hasCfOrder = baseCall._ops.orderBys.some((o: any) => o[0] === 'cf_vip')
    expect(hasCfOrder).toBe(true)
    // Assert an extension leftJoin was attempted
    const hasExtJoin = baseCall._ops.joins.length > 0
    expect(hasExtJoin).toBe(true)
  })
})
