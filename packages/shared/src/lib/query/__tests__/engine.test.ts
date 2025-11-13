import { BasicQueryEngine } from '../engine'
import { SortDir } from '../types'

// Mock modules with one entity extension
jest.mock('@/generated/modules.generated', () => ({
  modules: [
    { id: 'auth', entityExtensions: [ { base: 'auth:user', extension: 'my_module:user_profile', join: { baseKey: 'id', extensionKey: 'user_id' } } ] },
  ],
}))

type FakeData = Record<string, any[]>

function cloneRows(rows: any[] | undefined): any[] {
  if (!rows) return []
  return rows.map((row) => ({ ...row }))
}

function createFakeKnex(overrides?: FakeData) {
  const calls: any[] = []
  const defaultData: FakeData = {
    custom_field_defs: [
      { key: 'vip', entity_id: 'auth:user', is_active: true, config_json: '{}', kind: 'boolean' },
      { key: 'industry', entity_id: 'auth:user', is_active: true, config_json: '{}', kind: 'select' },
    ],
    custom_field_values: [],
  }
  const sourceData = { ...defaultData, ...(overrides || {}) }
  const data: FakeData = Object.fromEntries(
    Object.entries(sourceData).map(([table, rows]) => [table, cloneRows(rows)])
  )
  function raw(sql: string, params?: any[]) { return { toString: () => sql, sql, params } }
  function builderFor(tableArg: any) {
    let table = ''
    let alias: string | null = null
    if (typeof tableArg === 'string') {
      table = tableArg
    } else if (tableArg && typeof tableArg === 'object') {
      const first = Object.entries(tableArg)[0]
      if (first) {
        alias = String(first[0])
        table = String(first[1])
      }
    } else {
      table = String(tableArg || '')
    }
    const ops = { table, alias, wheres: [] as any[], joins: [] as any[], selects: [] as any[], orderBys: [] as any[], groups: [] as any[], limits: 0, offsets: 0, isCountDistinct: false }
    function recordJoin(type: 'left' | 'inner', aliasObj: any, fn: Function, ctxBuilder: () => any) {
      const entry: any = { type, aliasObj, conditions: [] as any[] }
      const ctx = ctxBuilder()
      ctx.on = (left: any, op: any, right: any) => {
        entry.conditions.push({ method: 'on', args: [left, op, right] })
        return ctx
      }
      ctx.andOn = (left: any, op: any, right: any) => {
        entry.conditions.push({ method: 'andOn', args: [left, op, right] })
        return ctx
      }
      fn.call(ctx)
      ops.joins.push(entry)
    }
    const b: any = {
      _ops: ops,
      select: function (...cols: any[]) { ops.selects.push(cols); return this },
      where: function (...args: any[]) { ops.wheres.push(args); return this },
      andWhere: function (...args: any[]) { ops.wheres.push(args); return this },
      whereIn: function (...args: any[]) { ops.wheres.push(['in', ...args]); return this },
      whereNotIn: function (...args: any[]) { ops.wheres.push(['notIn', ...args]); return this },
      whereNull: function (col: any) { ops.wheres.push(['isNull', col]); return this },
      whereNotNull: function (col: any) { ops.wheres.push(['notNull', col]); return this },
      whereExists: function (sub: any) { ops.wheres.push(['exists', sub]); return this },
      whereNotExists: function (sub: any) { ops.wheres.push(['notExists', sub]); return this },
      whereRaw: function (...args: any[]) { ops.wheres.push(['raw', ...args]); return this },
      orWhereNull: function (col: any) { ops.wheres.push(['orWhereNull', col]); return this },
      leftJoin: function (aliasObj: any, fn: Function) {
        recordJoin('left', aliasObj, fn, () => ({}))
        return this
      },
      join: function (aliasObj: any, fn: Function) {
        recordJoin('inner', aliasObj, fn, () => ({}))
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
  const fn: any = (table: any) => builderFor(table)
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
      sort: [{ field: 'cf:vip', dir: SortDir.Asc }],
      includeExtensions: true,
      organizationId: '1',
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

  test('customFieldSources join additional profiles for custom fields', async () => {
    const fakeKnex = createFakeKnex({
      custom_field_defs: [
        { key: 'birthday', entity_id: 'customers:customer_person_profile', is_active: true, config_json: JSON.stringify({ listVisible: true }), kind: 'text' },
        { key: 'sector', entity_id: 'customers:customer_company_profile', is_active: true, config_json: JSON.stringify({ listVisible: true }), kind: 'select' },
      ],
      custom_field_values: [],
      customer_entities: [],
      customer_people: [],
      customer_companies: [],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeKnex as any)
    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      includeCustomFields: ['birthday', 'sector'],
      fields: ['id', 'cf:birthday', 'cf:sector'],
      customFieldSources: [
        {
          entityId: 'customers:customer_person_profile',
          table: 'customer_people',
          alias: 'person_profile',
          recordIdColumn: 'id',
          join: { fromField: 'id', toField: 'entity_id' },
        },
        {
          entityId: 'customers:customer_company_profile',
          table: 'customer_companies',
          alias: 'company_profile',
          recordIdColumn: 'id',
          join: { fromField: 'id', toField: 'entity_id' },
        },
      ],
      page: { page: 1, pageSize: 10 },
    })
    const baseCall = fakeKnex._calls.find((b: any) => b._ops.table === 'customer_entities')
    expect(baseCall).toBeTruthy()
    const joinAliases = baseCall._ops.joins.map((j: any) => Object.keys(j.aliasObj)[0])
    expect(joinAliases).toEqual(expect.arrayContaining([
      'person_profile',
      'company_profile',
      'cfd_person_profile_birthday',
      'cfv_person_profile_birthday',
      'cfd_company_profile_sector',
      'cfv_company_profile_sector',
    ]))
    const personProfileJoin = baseCall._ops.joins.find((j: any) => j.aliasObj.person_profile)
    expect(personProfileJoin?.conditions.some((c: any) => c.args[0] === 'person_profile.entity_id' && c.args[2] === 'customer_entities.id')).toBe(true)
    const companyProfileJoin = baseCall._ops.joins.find((j: any) => j.aliasObj.company_profile)
    expect(companyProfileJoin?.conditions.some((c: any) => c.args[0] === 'company_profile.entity_id' && c.args[2] === 'customer_entities.id')).toBe(true)
    const cfvPersonJoin = baseCall._ops.joins.find((j: any) => j.aliasObj.cfv_person_profile_birthday)
    expect(cfvPersonJoin?.conditions.some((c: any) => c.args[0] === 'cfv_person_profile_birthday.record_id' && c.args[2]?.params?.[0] === 'person_profile.id')).toBe(true)
    const cfvCompanyJoin = baseCall._ops.joins.find((j: any) => j.aliasObj.cfv_company_profile_sector)
    expect(cfvCompanyJoin?.conditions.some((c: any) => c.args[0] === 'cfv_company_profile_sector.record_id' && c.args[2]?.params?.[0] === 'company_profile.id')).toBe(true)
    const defsEntityWhere = fakeKnex._calls
      .filter((b: any) => b._ops.table === 'custom_field_defs')
      .flatMap((b: any) => b._ops.wheres)
      .find((w: any) => Array.isArray(w) && w[0] === 'in' && w[1] === 'entity_id')
    expect(defsEntityWhere).toBeTruthy()
    const entityTargets = defsEntityWhere?.[2] || []
    expect(entityTargets).toEqual(expect.arrayContaining([
      'customers:customer_entity',
      'customers:customer_person_profile',
      'customers:customer_company_profile',
    ]))
  })

  test('join filters use whereExists with configured alias', async () => {
    const fakeKnex = createFakeKnex({
      customer_entities: [],
      customer_tag_assignments: [],
      'information_schema.columns': [
        { table_name: 'customer_tag_assignments', column_name: 'tag_id' },
        { table_name: 'customer_tag_assignments', column_name: 'tenant_id' },
        { table_name: 'customer_entities', column_name: 'tenant_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeKnex as any)
    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id'],
      joins: [
        {
          alias: 'tag_assignments',
          table: 'customer_tag_assignments',
          from: { field: 'id' },
          to: { field: 'entity_id' },
          type: 'left',
        },
      ],
      filters: {
        'tag_assignments.tag_id': { $in: ['tag-1', 'tag-2'] },
      },
      page: { page: 1, pageSize: 10 },
    })
    const baseCall = fakeKnex._calls.find((b: any) => b._ops.table === 'customer_entities')
    expect(baseCall).toBeTruthy()
    const existsFilter = baseCall._ops.wheres.find((w: any) => Array.isArray(w) && w[0] === 'exists')
    expect(existsFilter).toBeTruthy()
    const subQuery = existsFilter[1]
    expect(subQuery?._ops?.table).toBe('customer_tag_assignments')
    const hasInFilter = Array.isArray(subQuery?._ops?.wheres)
      ? subQuery._ops.wheres.some((w: any) => Array.isArray(w) && w[0] === 'in' && w[1] === 'tag_assignments.tag_id')
      : false
    expect(hasInFilter).toBe(true)
  })
})
