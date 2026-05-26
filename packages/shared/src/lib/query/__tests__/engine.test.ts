import { BasicQueryEngine } from '../engine'
import { SortDir } from '../types'
import { registerModules } from '../../i18n/server'

// Mock modules with one entity extension
const mockModules = [
  { id: 'auth', entityExtensions: [ { base: 'auth:user', extension: 'my_module:user_profile', join: { baseKey: 'id', extensionKey: 'user_id' } } ] },
]

// Register modules for the registration-based pattern
registerModules(mockModules as any)

type FakeData = Record<string, any[]>

function cloneRows(rows: any[] | undefined): any[] {
  if (!rows) return []
  return rows.map((row) => ({ ...row }))
}

/**
 * Build a fake Kysely that mimics the fluent API used by BasicQueryEngine.
 * Records operations on each SelectQueryBuilder so tests can inspect:
 *  - _ops.table / _ops.alias    — starting table (selectFrom target)
 *  - _ops.wheres                — `[type, ...args]` tuples
 *  - _ops.joins                 — `[{ type, aliasObj, conditions }]`
 *  - _ops.orderBys              — `[[column, dir]]`
 *  - _ops.groups                — grouped columns
 *  - _ops.selects               — select arguments
 *  - _ops.limits / _ops.offsets — pagination knobs
 */
function createFakeKysely(overrides?: FakeData) {
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
      if (produced && produced.kind === 'exists') return ['exists', produced.sub]
      if (produced && produced.kind === 'not' && produced.part?.kind === 'exists') return ['notExists', produced.part.sub]
      return ['expr', produced]
    }
    // (col, op, value) or sql template
    return args
  }

  function recordJoin(ops: any, type: 'left' | 'inner', spec: any, fn: Function) {
    const parsed = parseTableSpec(spec)
    const aliasObj = parsed.alias ? { [parsed.alias]: parsed.table } : { [parsed.table]: parsed.table }
    const entry: any = { type, aliasObj, conditions: [] as any[] }
    const ctx: any = {}
    ctx.on = (left: any, op?: any, right?: any) => {
      if (typeof left === 'function') {
        const expr = left(createExpressionBuilder())
        entry.conditions.push({ method: 'on', expr })
      } else {
        entry.conditions.push({ method: 'on', args: [left, op, right] })
      }
      return ctx
    }
    ctx.onRef = (left: any, op: any, right: any) => {
      entry.conditions.push({ method: 'on', args: [left, op, right] })
      return ctx
    }
    const result = fn(ctx)
    // onRef/on chain returns ctx; nothing else to do
    void result
    ops.joins.push(entry)
  }

  function makeBuilder(ops: any, record: boolean): any {
    const b: any = {
      _ops: ops,
      select(this: any, ...cols: any[]) {
        if (cols.length === 1 && Array.isArray(cols[0])) this._ops.selects.push(...cols[0])
        else this._ops.selects.push(...cols)
        return this
      },
      distinct(this: any) { return this },
      where(this: any, ...args: any[]) {
        this._ops.wheres.push(normalizeWhereArgs(args))
        return this
      },
      whereRef(this: any, left: any, op: any, right: any) {
        this._ops.wheres.push(['ref', left, op, right])
        return this
      },
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
      clearSelect(this: any) {
        const nextOps = { ...this._ops, selects: [] }
        return makeBuilder(nextOps, false)
      },
      clearOrderBy(this: any) {
        const nextOps = { ...this._ops, orderBys: [] }
        return makeBuilder(nextOps, false)
      },
      clearGroupBy(this: any) {
        const nextOps = { ...this._ops, groups: [] }
        return makeBuilder(nextOps, false)
      },
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
            (!targetTable || row.table_name === targetTable) &&
            (!targetColumn || row.column_name === targetColumn)
          )
        }
        if (localOps.table === 'information_schema.tables') {
          const infoRows = data['information_schema.tables']
          if (!Array.isArray(infoRows)) return undefined
          const targetTable = extractEqValue(localOps.wheres, 'table_name')
          return infoRows.find((row: any) => !targetTable || row.table_name === targetTable)
        }
        if (localOps.selects.some((s: any) => s && typeof s === 'object' && (s.__isCount || String(s?.alias || '') === 'count'))) {
          return { count: '0' }
        }
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

  const db: any = {
    selectFrom(spec: any) { return builderFor(spec) },
  }
  db._calls = calls
  return db
}

describe('BasicQueryEngine (Kysely)', () => {
  test('pluralizes entity names ending with y correctly', async () => {
    const fakeDb = createFakeKysely()
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('customers:customer_entity', { tenantId: 't1' })
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'customer_entities')
    expect(baseCall).toBeTruthy()
  })

  test('includeCustomFields true discovers keys and allows sort on cf:*; joins extensions', async () => {
    const fakeDb = createFakeKysely()
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
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
    const defsCall = fakeDb._calls.find((b: any) => b._ops.table === 'custom_field_defs')
    expect(defsCall).toBeTruthy()
    // Tenant filter (OR tenant_id is null) is expressed as an OR expression in Kysely
    const hasEntityFilter = defsCall._ops.wheres.some((w: any) =>
      Array.isArray(w) && w[0] === 'entity_id' && w[1] === 'in'
    )
    expect(hasEntityFilter).toBe(true)
    const hasTenantFilter = defsCall._ops.wheres.some((w: any) => {
      if (!Array.isArray(w)) return false
      const [kind, parts] = w
      if (kind !== 'or' || !Array.isArray(parts)) return false
      return parts.some((part: any) => part?.column === 'tenant_id' && part?.op === '=')
    })
    expect(hasTenantFilter).toBe(true)
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'users')
    const hasCfOrder = baseCall._ops.orderBys.some((o: any) => o[0] === 'cf_vip')
    expect(hasCfOrder).toBe(true)
    const hasExtJoin = baseCall._ops.joins.length > 0
    expect(hasExtJoin).toBe(true)
  })

  test('customFieldSources join additional profiles for custom fields', async () => {
    const fakeDb = createFakeKysely({
      custom_field_defs: [
        { key: 'birthday', entity_id: 'customers:customer_person_profile', is_active: true, config_json: JSON.stringify({ listVisible: true }), kind: 'text' },
        { key: 'sector', entity_id: 'customers:customer_company_profile', is_active: true, config_json: JSON.stringify({ listVisible: true }), kind: 'select' },
      ],
      custom_field_values: [],
      customer_entities: [],
      customer_people: [],
      customer_companies: [],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
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
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'customer_entities')
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
    expect(personProfileJoin?.conditions.some((c: any) => c.args?.[0] === 'person_profile.entity_id' && c.args?.[2] === 'customer_entities.id')).toBe(true)
    const companyProfileJoin = baseCall._ops.joins.find((j: any) => j.aliasObj.company_profile)
    expect(companyProfileJoin?.conditions.some((c: any) => c.args?.[0] === 'company_profile.entity_id' && c.args?.[2] === 'customer_entities.id')).toBe(true)
    // cfv joins use onRef(`${valAlias}.record_id`, '=', recordIdExpr) where recordIdExpr is a sql template referencing person_profile.id
    const cfvPersonJoin = baseCall._ops.joins.find((j: any) => j.aliasObj.cfv_person_profile_birthday)
    expect(cfvPersonJoin).toBeTruthy()
    expect(cfvPersonJoin.conditions.some((c: any) => c.args?.[0] === 'cfv_person_profile_birthday.record_id')).toBe(true)
    const cfvCompanyJoin = baseCall._ops.joins.find((j: any) => j.aliasObj.cfv_company_profile_sector)
    expect(cfvCompanyJoin).toBeTruthy()
    expect(cfvCompanyJoin.conditions.some((c: any) => c.args?.[0] === 'cfv_company_profile_sector.record_id')).toBe(true)
    const defsInFilter = fakeDb._calls
      .filter((b: any) => b._ops.table === 'custom_field_defs')
      .flatMap((b: any) => b._ops.wheres)
      .find((w: any) => Array.isArray(w) && w[0] === 'entity_id' && w[1] === 'in')
    expect(defsInFilter).toBeTruthy()
    const entityTargets = defsInFilter?.[2] || []
    expect(entityTargets).toEqual(expect.arrayContaining([
      'customers:customer_entity',
      'customers:customer_person_profile',
      'customers:customer_company_profile',
    ]))
  })

  test('customFieldSources aliases support object equality filters', async () => {
    const fakeDb = createFakeKysely({
      customer_entities: [],
      customer_people: [],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'tenant_id' },
        { table_name: 'customer_people', column_name: 'id' },
        { table_name: 'customer_people', column_name: 'tenant_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id'],
      customFieldSources: [
        {
          entityId: 'customers:customer_person_profile',
          table: 'customer_people',
          alias: 'person_profile',
          join: { fromField: 'id', toField: 'entity_id' },
        },
      ],
      filters: {
        'person_profile.id': { $eq: 'profile-1' },
      },
      page: { page: 1, pageSize: 10 },
    })
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'customer_entities')
    expect(baseCall).toBeTruthy()
    const existsFilter = baseCall._ops.wheres.find((w: any) => Array.isArray(w) && w[0] === 'exists')
    expect(existsFilter).toBeTruthy()
    const subQuery = existsFilter[1]
    expect(subQuery?._ops?.table).toBe('customer_people')
    const hasEqualityFilter = Array.isArray(subQuery?._ops?.wheres)
      ? subQuery._ops.wheres.some((w: any) => Array.isArray(w) && w[0] === 'person_profile.id' && w[1] === '=' && w[2] === 'profile-1')
      : false
    expect(hasEqualityFilter).toBe(true)
  })

  test('customFieldSources equality filters stay exact when search tokens are available', async () => {
    const fakeDb = createFakeKysely({
      customer_entities: [],
      customer_people: [],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'tenant_id' },
        { table_name: 'customer_people', column_name: 'id' },
        { table_name: 'customer_people', column_name: 'tenant_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    jest.spyOn(engine as any, 'tableExists').mockResolvedValue(true)
    jest.spyOn(engine as any, 'hasSearchTokens').mockResolvedValue(true)
    const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id'],
      customFieldSources: [
        {
          entityId: 'customers:customer_person_profile',
          table: 'customer_people',
          alias: 'person_profile',
          join: { fromField: 'id', toField: 'entity_id' },
        },
      ],
      filters: {
        'person_profile.id': { $eq: 'profile-1' },
      },
      page: { page: 1, pageSize: 10 },
    })

    // When search tokens are available, equality filters on joined fields should stay exact
    // (not use tokenized matching) and route through EXISTS subquery
    expect(applySearchTokensSpy).not.toHaveBeenCalled()
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'customer_entities')
    expect(baseCall).toBeTruthy()
    // The join subquery that the parent whereExists wraps MUST still target customer_people
    const existsFilter = baseCall._ops.wheres.find((w: any) => Array.isArray(w) && w[0] === 'exists')
    expect(existsFilter).toBeTruthy()
    expect(existsFilter[1]?._ops?.table).toBe('customer_people')
  })

  test('customFieldSources equality filters stay exact when search is disabled', async () => {
    // This is the baseline row-set invariant: when the search-tokens table is
    // absent (searchEnabled=false), $eq must route through the exact EXISTS
    // subquery path, producing the pre-change `person_profile.id = 'profile-1'`
    // filter — not the tokenized OR across search-tokens columns.
    const fakeDb = createFakeKysely({
      customer_entities: [],
      customer_people: [],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'tenant_id' },
        { table_name: 'customer_people', column_name: 'id' },
        { table_name: 'customer_people', column_name: 'tenant_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    jest.spyOn(engine as any, 'tableExists').mockResolvedValue(false)
    const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id'],
      customFieldSources: [
        {
          entityId: 'customers:customer_person_profile',
          table: 'customer_people',
          alias: 'person_profile',
          join: { fromField: 'id', toField: 'entity_id' },
        },
      ],
      filters: {
        'person_profile.id': { $eq: 'profile-1' },
      },
      page: { page: 1, pageSize: 10 },
    })

    expect(applySearchTokensSpy).not.toHaveBeenCalled()
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'customer_entities')
    expect(baseCall).toBeTruthy()
    const existsFilter = baseCall._ops.wheres.find((w: any) => Array.isArray(w) && w[0] === 'exists')
    expect(existsFilter).toBeTruthy()
    const subQuery = existsFilter[1]
    expect(subQuery?._ops?.table).toBe('customer_people')
    const hasEqualityFilter = Array.isArray(subQuery?._ops?.wheres)
      ? subQuery._ops.wheres.some((w: any) => Array.isArray(w) && w[0] === 'person_profile.id' && w[1] === '=' && w[2] === 'profile-1')
      : false
    expect(hasEqualityFilter).toBe(true)
  })

  test('uses search tokens for index document fields on base entities', async () => {
    const fakeDb = createFakeKysely({
      todos: [],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    const tableExistsSpy = jest.spyOn(engine as any, 'tableExists').mockResolvedValue(true)
    const hasSearchTokensSpy = jest.spyOn(engine as any, 'hasSearchTokens').mockResolvedValue(true)
    const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

    await engine.query('example:todo', {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id'],
      filters: {
        search_text: { $ilike: '%avision%' },
      },
      page: { page: 1, pageSize: 10 },
    })

    expect(tableExistsSpy).toHaveBeenCalledWith('search_tokens')
    expect(hasSearchTokensSpy).toHaveBeenCalledWith(
      'example:todo',
      't1',
      expect.objectContaining({ ids: ['org1'] }),
    )
    expect(applySearchTokensSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entity: 'example:todo',
        field: 'search_text',
        recordIdColumn: 'todos.id',
      }),
    )
  })

  test('join filters use whereExists with configured alias', async () => {
    const fakeDb = createFakeKysely({
      customer_entities: [],
      customer_tag_assignments: [],
      'information_schema.columns': [
        { table_name: 'customer_tag_assignments', column_name: 'tag_id' },
        { table_name: 'customer_tag_assignments', column_name: 'tenant_id' },
        { table_name: 'customer_entities', column_name: 'tenant_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
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
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'customer_entities')
    expect(baseCall).toBeTruthy()
    const existsFilter = baseCall._ops.wheres.find((w: any) => Array.isArray(w) && w[0] === 'exists')
    expect(existsFilter).toBeTruthy()
    const subQuery = existsFilter[1]
    expect(subQuery?._ops?.table).toBe('customer_tag_assignments')
    const hasInFilter = Array.isArray(subQuery?._ops?.wheres)
      ? subQuery._ops.wheres.some((w: any) => Array.isArray(w) && w[0] === 'tag_assignments.tag_id' && w[1] === 'in')
      : false
    expect(hasInFilter).toBe(true)
  })
})
