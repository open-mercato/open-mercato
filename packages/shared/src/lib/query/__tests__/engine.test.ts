import { BasicQueryEngine } from '../engine'
import { SortDir } from '../types'
import { registerModules } from '../../i18n/server'
import { clearSearchTokenPresenceCache } from '../../search/availability'
import { clearEncryptedLikeFieldsCache, clearColumnExistsCache, columnExistsCacheSize } from '../engine'

// The token-presence answer is cached process-wide (TTL); without clearing it,
// probe-count assertions would observe hits from earlier tests in this file.
beforeEach(() => {
  clearSearchTokenPresenceCache()
  clearEncryptedLikeFieldsCache()
  clearColumnExistsCache()
})

// Mock modules with one entity extension
const mockModules = [
  { id: 'auth', entityExtensions: [ { base: 'auth:user', extension: 'my_module:user_profile', join: { baseKey: 'id', extensionKey: 'user_id' } } ] },
  {
    id: 'example',
    entityExtensions: [
      // Declares `table` explicitly; the derived plural now agrees with it.
      { base: 'customers:customer_entity', extension: 'example:example_customer_priority', join: { baseKey: 'id', extensionKey: 'customer_id' }, table: 'example_customer_priorities' },
      // No `table`: exercises the derived-plural fallback.
      { base: 'auth:role', extension: 'example:example_role_policy', join: { baseKey: 'id', extensionKey: 'role_id' } },
      // `table` is not a bare identifier, so the engine must refuse it.
      { base: 'auth:session', extension: 'example:example_session_note', join: { baseKey: 'id', extensionKey: 'session_id' }, table: 'notes"; drop table users --' },
    ],
  },
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
          // An aggregate over a recorded subquery (the capped-count probe) counts
          // the subquery's source rows bounded by its LIMIT, mirroring Postgres.
          if (localOps.subquery) {
            const sourceRows = (data[localOps.subquery.table] || []).length
            const innerLimit = localOps.subquery.limits
            return { count: String(innerLimit ? Math.min(sourceRows, innerLimit) : sourceRows) }
          }
          return { count: String((data[localOps.table] || []).length) }
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

  const db: any = {
    selectFrom(spec: any) { return builderFor(spec) },
  }
  db._calls = calls
  return db
}

// Selects are recorded verbatim, so a plain column arrives as a string while an
// aggregated cf projection arrives as Kysely's aliased raw builder.
function selectAliases(call: any): string[] {
  return call._ops.selects.map((s: any) => (typeof s === 'string' ? s : String(s?.alias ?? '')))
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

  test('a cf sort alone projects and joins the key it orders by', async () => {
    const fakeDb = createFakeKysely()
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('auth:user', {
      fields: ['id', 'email'],
      sort: [{ field: 'cf:vip', dir: SortDir.Asc }],
      organizationId: '1',
      tenantId: 't1',
    })
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'users')
    expect(baseCall._ops.orderBys).toContainEqual(['cf_vip', 'asc'])
    // Ordering by an alias the query never selected is a Postgres 42703, so the
    // sort has to bring its own projection and joins along (#5521).
    expect(selectAliases(baseCall)).toContain('cf_vip')
    expect(baseCall._ops.joins.length).toBeGreaterThan(0)
  })

  test('a cf sort that resolves to no definition is dropped, not ordered by', async () => {
    const fakeDb = createFakeKysely()
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query('auth:user', {
      fields: ['id', 'email'],
      sort: [{ field: 'cf:no_such_key', dir: SortDir.Asc }],
      organizationId: '1',
      tenantId: 't1',
    })
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'users')
    // Dropping an unresolvable sort is what the base-column branch already does;
    // the alternative here was an ORDER BY over a column that is never selected.
    expect(baseCall._ops.orderBys).toEqual([])
    expect(selectAliases(baseCall)).not.toContain('cf_no_such_key')
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
      search_tokens: [{ one: 1 }],
      'information_schema.tables': [{ table_name: 'search_tokens' }],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'tenant_id' },
        { table_name: 'customer_people', column_name: 'id' },
        { table_name: 'customer_people', column_name: 'tenant_id' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
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
      search_tokens: [{ one: 1 }],
      'information_schema.tables': [{ table_name: 'search_tokens' }],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
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

    const calls = fakeDb._calls as Array<{ _ops: { table: string; wheres: unknown[][] } }>
    const tableProbe = calls.find((call) =>
      call._ops.table === 'information_schema.tables' &&
      call._ops.wheres.some((where) => where[0] === 'table_name' && where[2] === 'search_tokens'))
    expect(tableProbe).toBeTruthy()
    const tokenProbe = calls.find((call) =>
      call._ops.table === 'search_tokens' &&
      call._ops.wheres.some((where) => where[0] === 'entity_type' && where[2] === 'example:todo'))
    expect(tokenProbe).toBeTruthy()
    expect(applySearchTokensSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entity: 'example:todo',
        field: 'search_text',
        recordIdColumn: 'todos.id',
      }),
    )
  })

  test('bypasses search-token filtering when automatic scope is explicitly disabled', async () => {
    const fakeDb = createFakeKysely({
      todos: [],
      'information_schema.tables': [
        { table_name: 'search_tokens' },
      ],
      'information_schema.columns': [
        { table_name: 'todos', column_name: 'search_text' },
      ],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

    await engine.query('example:todo', {
      tenantId: 't1',
      fields: ['id'],
      omitAutomaticTenantOrgScope: true,
      filters: {
        search_text: { $ilike: '%avision%' },
      },
      page: { page: 1, pageSize: 10 },
    })

    const calls = fakeDb._calls as Array<{ _ops: { table: string } }>
    expect(calls.some((call) => call._ops.table === 'search_tokens')).toBe(false)
    expect(applySearchTokensSpy).not.toHaveBeenCalled()
    const baseCall = fakeDb._calls.find((builder: any) => builder._ops.table === 'todos')
    expect(baseCall?._ops.wheres).toContainEqual(['todos.search_text', 'ilike', '%avision%'])
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

  test('exposes resolved customFieldDefinitions when includeCustomFields is true (issue #2133)', async () => {
    const fakeDb = createFakeKysely()
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    const res = await engine.query('auth:user', {
      includeCustomFields: true,
      fields: ['id'],
      organizationId: '1',
      tenantId: 't1',
      page: { page: 1, pageSize: 10 },
    })
    expect(res.customFieldDefinitions).toBeDefined()
    expect(res.customFieldDefinitions!.entityIds).toEqual(['auth:user'])
    expect(res.customFieldDefinitions!.tenantId).toBe('t1')
    expect(res.customFieldDefinitions!.organizationIds).toEqual(['1'])
    expect(Array.from(res.customFieldDefinitions!.index.keys()).sort()).toEqual(['industry', 'vip'])
  })

  test('exposed customFieldDefinitions index drops soft-deleted and foreign-org defs', async () => {
    const fakeDb = createFakeKysely({
      custom_field_defs: [
        { key: 'kept', entity_id: 'auth:user', is_active: true, config_json: '{}', kind: 'text', organization_id: null, tenant_id: 't1', updated_at: null, deleted_at: null },
        { key: 'foreign', entity_id: 'auth:user', is_active: true, config_json: '{}', kind: 'text', organization_id: 'other-org', tenant_id: 't1', updated_at: null, deleted_at: null },
        { key: 'gone', entity_id: 'auth:user', is_active: true, config_json: '{}', kind: 'text', organization_id: null, tenant_id: 't1', updated_at: null, deleted_at: '2026-01-01T00:00:00.000Z' },
      ],
      custom_field_values: [],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    const res = await engine.query('auth:user', {
      includeCustomFields: true,
      fields: ['id'],
      organizationId: 'allowed-org',
      tenantId: 't1',
      page: { page: 1, pageSize: 10 },
    })
    expect(Array.from(res.customFieldDefinitions!.index.keys())).toEqual(['kept'])
  })

  test('customFieldDefinitions entityIds include base entity plus custom field sources', async () => {
    const fakeDb = createFakeKysely({
      custom_field_defs: [
        { key: 'birthday', entity_id: 'customers:customer_person_profile', is_active: true, config_json: '{}', kind: 'text', organization_id: null, tenant_id: 't1', updated_at: null, deleted_at: null },
      ],
      custom_field_values: [],
      customer_entities: [],
      customer_people: [],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    const res = await engine.query('customers:customer_entity', {
      tenantId: 't1',
      includeCustomFields: true,
      fields: ['id'],
      customFieldSources: [
        {
          entityId: 'customers:customer_person_profile',
          table: 'customer_people',
          alias: 'person_profile',
          recordIdColumn: 'id',
          join: { fromField: 'id', toField: 'entity_id' },
        },
      ],
      page: { page: 1, pageSize: 10 },
    })
    expect(res.customFieldDefinitions!.entityIds.sort()).toEqual([
      'customers:customer_entity',
      'customers:customer_person_profile',
    ])
  })

  test('does not expose customFieldDefinitions when includeCustomFields is a key list', async () => {
    const fakeDb = createFakeKysely()
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    const res = await engine.query('auth:user', {
      includeCustomFields: ['vip'],
      fields: ['id', 'cf:vip'],
      tenantId: 't1',
      page: { page: 1, pageSize: 10 },
    })
    expect(res.customFieldDefinitions).toBeUndefined()
  })

  test('sorts encrypted base fields after decryption before pagination', async () => {
    const fakeDb = createFakeKysely({
      customer_entities: [
        { id: '3', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-c' },
        { id: '1', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-a' },
        { id: '5', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-e' },
        { id: '2', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-b' },
        { id: '4', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-d' },
      ],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'id' },
        { table_name: 'customer_entities', column_name: 'tenant_id' },
        { table_name: 'customer_entities', column_name: 'organization_id' },
        { table_name: 'customer_entities', column_name: 'deleted_at' },
        { table_name: 'customer_entities', column_name: 'display_name' },
      ],
    })
    const namesById: Record<string, string> = {
      '1': 'Alice',
      '2': 'Bob',
      '3': 'Charlie',
      '4': 'Dave',
      '5': 'Eve',
    }
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({
        isEnabled: () => true,
        getEncryptedFieldNames: async () => ['display_name'],
        decryptEntityPayload: async (_entityId, payload) => ({
          display_name: namesById[String(payload.id)],
        }),
      }),
    )

    const result = await engine.query('customers:customer_entity', {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id', 'display_name'],
      sort: [{ field: 'display_name', dir: SortDir.Asc }],
      page: { page: 2, pageSize: 2 },
    })

    expect(result.items.map((item: any) => item.display_name)).toEqual(['Charlie', 'Dave'])
    const baseCalls = fakeDb._calls.filter((call: any) => call._ops.table === 'customer_entities')
    expect(baseCalls.length).toBe(3)
    // qFull ('full' projection) is built first (used for phase 2), then the
    // 'count' projection (the bounded count probe), then 'sortKeys' (phase 1).
    const [phase2Call, , phase1Call] = baseCalls
    // Phase 1 (slim id+sort-column scan): no SQL order/limit — the full candidate
    // set is fetched, decrypted, and sorted in memory.
    expect(phase1Call._ops.orderBys).toEqual([])
    expect(phase1Call._ops.limits).toBe(0)
    // Phase 2 (full-row fetch for the page's ids): filtered by `id in [...]`, no
    // SQL order/limit needed since the id list already bounds it to the page.
    expect(phase2Call._ops.orderBys).toEqual([])
    expect(phase2Call._ops.limits).toBe(0)
    expect(phase2Call._ops.wheres.some((w: any) => Array.isArray(w) && w[0] === 'customer_entities.id' && w[1] === 'in')).toBe(true)
  })

  test('sorts encrypted base fields in all-organization scope', async () => {
    const fakeDb = createFakeKysely({
      customer_entities: [
        { id: '1', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-c' },
        { id: '2', tenant_id: 't1', organization_id: 'org2', display_name: 'cipher-a' },
        { id: '3', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-b' },
      ],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'id' },
        { table_name: 'customer_entities', column_name: 'tenant_id' },
        { table_name: 'customer_entities', column_name: 'organization_id' },
        { table_name: 'customer_entities', column_name: 'deleted_at' },
        { table_name: 'customer_entities', column_name: 'display_name' },
      ],
    })
    const namesById: Record<string, string> = {
      '1': 'Combocompany',
      '2': 'Aardvark Solutions',
      '3': 'Beta Corp',
    }
    const orgById: Record<string, string> = {
      '1': 'org1',
      '2': 'org2',
      '3': 'org1',
    }
    const encryptedFieldLookups: Array<string | null | undefined> = []
    const decryptScopes: Array<string | null> = []
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({
        isEnabled: () => true,
        getEncryptedFieldNames: async (_entityId, _tenantId, organizationId) => {
          encryptedFieldLookups.push(organizationId)
          return organizationId == null ? ['display_name'] : []
        },
        decryptEntityPayload: async (_entityId, payload, _tenantId, organizationId) => {
          decryptScopes.push(organizationId ?? null)
          const id = String(payload.id)
          return organizationId === orgById[id] ? { display_name: namesById[id] } : {}
        },
      }),
    )

    const result = await engine.query('customers:customer_entity', {
      tenantId: 't1',
      organizationIds: ['org1', 'org2'],
      fields: ['id', 'display_name', 'organization_id'],
      sort: [{ field: 'display_name', dir: SortDir.Asc }],
      page: { page: 1, pageSize: 3 },
    })

    expect(encryptedFieldLookups).toEqual([null])
    expect(decryptScopes.slice(0, 3)).toEqual(['org1', 'org2', 'org1'])
    expect(decryptScopes).toEqual(expect.arrayContaining(['org1', 'org2']))
    expect(result.items.map((item: any) => item.display_name)).toEqual([
      'Aardvark Solutions',
      'Beta Corp',
      'Combocompany',
    ])
    const baseCalls = fakeDb._calls.filter((call: any) => call._ops.table === 'customer_entities')
    const [phase2Call, phase1Call] = baseCalls
    expect(phase1Call._ops.orderBys).toEqual([])
    expect(phase2Call._ops.wheres.some((w: any) => Array.isArray(w) && w[0] === 'customer_entities.id' && w[1] === 'in')).toBe(true)
  })

  test('paginates encrypted-sorted results correctly on page 1 and the tail page', async () => {
    const fakeDb = createFakeKysely({
      customer_entities: [
        { id: '3', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-c' },
        { id: '1', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-a' },
        { id: '5', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-e' },
        { id: '2', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-b' },
        { id: '4', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-d' },
      ],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'id' },
        { table_name: 'customer_entities', column_name: 'tenant_id' },
        { table_name: 'customer_entities', column_name: 'organization_id' },
        { table_name: 'customer_entities', column_name: 'deleted_at' },
        { table_name: 'customer_entities', column_name: 'display_name' },
      ],
    })
    const namesById: Record<string, string> = {
      '1': 'Alice', '2': 'Bob', '3': 'Charlie', '4': 'Dave', '5': 'Eve',
    }
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({
        isEnabled: () => true,
        getEncryptedFieldNames: async () => ['display_name'],
        decryptEntityPayload: async (_entityId, payload) => ({
          display_name: namesById[String(payload.id)],
        }),
      }),
    )

    const page1 = await engine.query('customers:customer_entity', {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id', 'display_name'],
      sort: [{ field: 'display_name', dir: SortDir.Asc }],
      page: { page: 1, pageSize: 2 },
    })
    expect(page1.items.map((item: any) => item.display_name)).toEqual(['Alice', 'Bob'])

    const page3 = await engine.query('customers:customer_entity', {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id', 'display_name'],
      sort: [{ field: 'display_name', dir: SortDir.Asc }],
      page: { page: 3, pageSize: 2 },
    })
    expect(page3.items.map((item: any) => item.display_name)).toEqual(['Eve'])
  })

  describe('OM_ENCRYPTED_SORT_MAX_ROWS cap', () => {
    const originalEnv = process.env.OM_ENCRYPTED_SORT_MAX_ROWS

    afterEach(() => {
      if (originalEnv === undefined) delete process.env.OM_ENCRYPTED_SORT_MAX_ROWS
      else process.env.OM_ENCRYPTED_SORT_MAX_ROWS = originalEnv
    })

    function buildFixture() {
      const fakeDb = createFakeKysely({
        customer_entities: [
          { id: '3', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-c' },
          { id: '1', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-a' },
          { id: '5', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-e' },
          { id: '2', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-b' },
          { id: '4', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-d' },
        ],
        'information_schema.columns': [
          { table_name: 'customer_entities', column_name: 'id' },
          { table_name: 'customer_entities', column_name: 'tenant_id' },
          { table_name: 'customer_entities', column_name: 'organization_id' },
          { table_name: 'customer_entities', column_name: 'deleted_at' },
          { table_name: 'customer_entities', column_name: 'display_name' },
        ],
      })
      const namesById: Record<string, string> = {
        '1': 'Alice', '2': 'Bob', '3': 'Charlie', '4': 'Dave', '5': 'Eve',
      }
      const engine = new BasicQueryEngine(
        {} as any,
        () => fakeDb as any,
        () => ({
          isEnabled: () => true,
          getEncryptedFieldNames: async () => ['display_name'],
          decryptEntityPayload: async (_entityId, payload) => ({
            display_name: namesById[String(payload.id)],
          }),
        }),
      )
      return { fakeDb, engine }
    }

    test('unset: no limit on the phase-1 scan, no warning', async () => {
      delete process.env.OM_ENCRYPTED_SORT_MAX_ROWS
      const { fakeDb, engine } = buildFixture()
      const result = await engine.query('customers:customer_entity', {
        tenantId: 't1',
        organizationId: 'org1',
        fields: ['id', 'display_name'],
        sort: [{ field: 'display_name', dir: SortDir.Asc }],
        page: { page: 1, pageSize: 2 },
      })
      expect(result.meta?.encryptedSortRowCapWarning).toBeUndefined()
      const [, , phase1Call] = fakeDb._calls.filter((call: any) => call._ops.table === 'customer_entities')
      expect(phase1Call._ops.limits).toBe(0)
    })

    test('set but not exceeded: no warning, identical results to uncapped', async () => {
      process.env.OM_ENCRYPTED_SORT_MAX_ROWS = '10'
      const { fakeDb, engine } = buildFixture()
      const result = await engine.query('customers:customer_entity', {
        tenantId: 't1',
        organizationId: 'org1',
        fields: ['id', 'display_name'],
        sort: [{ field: 'display_name', dir: SortDir.Asc }],
        page: { page: 1, pageSize: 2 },
      })
      expect(result.meta?.encryptedSortRowCapWarning).toBeUndefined()
      expect(result.items.map((item: any) => item.display_name)).toEqual(['Alice', 'Bob'])
    })

    test('set and exceeded: caps + orders the phase-1 scan and attaches a warning', async () => {
      process.env.OM_ENCRYPTED_SORT_MAX_ROWS = '3'
      const { fakeDb, engine } = buildFixture()
      const result = await engine.query('customers:customer_entity', {
        tenantId: 't1',
        organizationId: 'org1',
        fields: ['id', 'display_name'],
        sort: [{ field: 'display_name', dir: SortDir.Asc }],
        page: { page: 1, pageSize: 2 },
      })
      expect(result.meta?.encryptedSortRowCapWarning).toEqual({
        entity: 'customers:customer_entity',
        sortFields: ['display_name'],
        maxRows: 3,
        totalMatched: 5,
      })
      const [, , phase1Call] = fakeDb._calls.filter((call: any) => call._ops.table === 'customer_entities')
      // cap + 1 probe: truncation is detected from the candidate scan itself,
      // not by comparing against a (possibly capped) total.
      expect(phase1Call._ops.limits).toBe(4)
      expect(phase1Call._ops.orderBys).toEqual([['customer_entities.id', 'asc']])
    })

    test('still warns when the list count itself is capped below the matched set', async () => {
      // The old detection compared `total > sortCap`; with OM_LIST_COUNT_CAP at or
      // below the sort cap that comparison can never fire. The probe must warn anyway.
      process.env.OM_ENCRYPTED_SORT_MAX_ROWS = '3'
      process.env.OM_LIST_COUNT_CAP = '3'
      try {
        const { engine } = buildFixture()
        const result = await engine.query('customers:customer_entity', {
          tenantId: 't1',
          organizationId: 'org1',
          fields: ['id', 'display_name'],
          sort: [{ field: 'display_name', dir: SortDir.Asc }],
          page: { page: 1, pageSize: 2 },
        })
        expect(result.total).toBe(3)
        expect(result.meta?.listCountCapWarning).toEqual({ entity: 'customers:customer_entity', cap: 3 })
        expect(result.meta?.encryptedSortRowCapWarning).toMatchObject({
          entity: 'customers:customer_entity',
          maxRows: 3,
        })
      } finally {
        delete process.env.OM_LIST_COUNT_CAP
      }
    })
  })

  test('keeps SQL ordering and pagination for unencrypted base fields', async () => {
    const fakeDb = createFakeKysely({
      customer_entities: [
        { id: '1', tenant_id: 't1', organization_id: 'org1', display_name: 'Alice' },
      ],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'id' },
        { table_name: 'customer_entities', column_name: 'tenant_id' },
        { table_name: 'customer_entities', column_name: 'organization_id' },
        { table_name: 'customer_entities', column_name: 'deleted_at' },
        { table_name: 'customer_entities', column_name: 'display_name' },
      ],
    })
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({
        isEnabled: () => true,
        getEncryptedFieldNames: async () => [],
      }),
    )

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id', 'display_name'],
      sort: [{ field: 'display_name', dir: SortDir.Asc }],
      page: { page: 2, pageSize: 10 },
    })

    const baseCall = fakeDb._calls.find((call: any) => call._ops.table === 'customer_entities')
    expect(baseCall._ops.orderBys).toEqual([['customer_entities.display_name', 'asc']])
    expect(baseCall._ops.limits).toBe(10)
    expect(baseCall._ops.offsets).toBe(10)
  })

  describe('OM_LIST_COUNT_CAP boundary', () => {
    const originalCap = process.env.OM_LIST_COUNT_CAP
    afterEach(() => {
      if (originalCap === undefined) delete process.env.OM_LIST_COUNT_CAP
      else process.env.OM_LIST_COUNT_CAP = originalCap
    })

    function buildFixture(rowCount: number) {
      const rows = Array.from({ length: rowCount }, (_, i) => ({
        id: String(i + 1), tenant_id: 't1', organization_id: 'org1', display_name: `Row ${i + 1}`,
      }))
      const fakeDb = createFakeKysely({
        customer_entities: rows,
        'information_schema.columns': [
          { table_name: 'customer_entities', column_name: 'id' },
          { table_name: 'customer_entities', column_name: 'tenant_id' },
          { table_name: 'customer_entities', column_name: 'organization_id' },
          { table_name: 'customer_entities', column_name: 'deleted_at' },
          { table_name: 'customer_entities', column_name: 'display_name' },
        ],
      })
      const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
      return { fakeDb, engine }
    }

    const query = (engine: BasicQueryEngine) => engine.query('customers:customer_entity', {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id'],
      page: { page: 1, pageSize: 2 },
    })

    test('cap - 1 matching rows: exact total, no flag', async () => {
      process.env.OM_LIST_COUNT_CAP = '5'
      const { engine } = buildFixture(4)
      const result = await query(engine)
      expect(result.total).toBe(4)
      expect(result.meta?.listCountCapWarning).toBeUndefined()
    })

    test('exactly cap matching rows: exact total, no flag — a genuine total of cap is not mislabeled', async () => {
      process.env.OM_LIST_COUNT_CAP = '5'
      const { engine } = buildFixture(5)
      const result = await query(engine)
      expect(result.total).toBe(5)
      expect(result.meta?.listCountCapWarning).toBeUndefined()
    })

    test('cap + 1 matching rows: total reports cap (not the probe value) with the warning', async () => {
      process.env.OM_LIST_COUNT_CAP = '5'
      const { engine } = buildFixture(6)
      const result = await query(engine)
      expect(result.total).toBe(5)
      expect(result.meta?.listCountCapWarning).toEqual({ entity: 'customers:customer_entity', cap: 5 })
    })

    test('OM_LIST_COUNT_CAP=0: exact totals however large the set', async () => {
      process.env.OM_LIST_COUNT_CAP = '0'
      const { engine } = buildFixture(7)
      const result = await query(engine)
      expect(result.total).toBe(7)
      expect(result.meta?.listCountCapWarning).toBeUndefined()
    })

    test('unparseable value falls back to the default cap rather than disabling it', async () => {
      process.env.OM_LIST_COUNT_CAP = 'not-a-number'
      const { fakeDb, engine } = buildFixture(3)
      const result = await query(engine)
      expect(result.total).toBe(3)
      const outer = fakeDb._calls.find((call: any) => call._ops.table === '__subquery__')
      expect(outer._ops.subquery.limits).toBe(10_001)
    })
  })

  // A tiebreak sort is only worth configuring if the engine actually emits it.
  // `list.tiebreakSortField` (used by the sales line routes to keep lines with an
  // equal `line_number` in a repeatable order) is the first caller to pass more
  // than one sort element, so pin that every element reaches ORDER BY in order —
  // dropping sort[1] would silently restore the non-determinism it exists to fix.
  test('emits every sort element as an ORDER BY column, in order', async () => {
    const fakeDb = createFakeKysely({
      sales_order_lines: [
        { id: 'b', tenant_id: 't1', organization_id: 'org1', line_number: 0 },
        { id: 'a', tenant_id: 't1', organization_id: 'org1', line_number: 0 },
      ],
      'information_schema.columns': [
        { table_name: 'sales_order_lines', column_name: 'id' },
        { table_name: 'sales_order_lines', column_name: 'tenant_id' },
        { table_name: 'sales_order_lines', column_name: 'organization_id' },
        { table_name: 'sales_order_lines', column_name: 'deleted_at' },
        { table_name: 'sales_order_lines', column_name: 'line_number' },
      ],
    })
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({
        isEnabled: () => true,
        getEncryptedFieldNames: async () => [],
      }),
    )

    await engine.query('sales:sales_order_line', {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id', 'line_number'],
      sort: [
        { field: 'line_number', dir: SortDir.Asc },
        { field: 'id', dir: SortDir.Asc },
      ],
      page: { page: 1, pageSize: 10 },
    })

    const baseCall = fakeDb._calls.find((call: any) => call._ops.table === 'sales_order_lines')
    expect(baseCall._ops.orderBys).toEqual([
      ['sales_order_lines.line_number', 'asc'],
      ['sales_order_lines.id', 'asc'],
    ])
  })

  test('keeps each sort element on its own direction', async () => {
    const fakeDb = createFakeKysely({
      sales_order_lines: [
        { id: 'a', tenant_id: 't1', organization_id: 'org1', line_number: 1 },
      ],
      'information_schema.columns': [
        { table_name: 'sales_order_lines', column_name: 'id' },
        { table_name: 'sales_order_lines', column_name: 'tenant_id' },
        { table_name: 'sales_order_lines', column_name: 'organization_id' },
        { table_name: 'sales_order_lines', column_name: 'deleted_at' },
        { table_name: 'sales_order_lines', column_name: 'line_number' },
      ],
    })
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({
        isEnabled: () => true,
        getEncryptedFieldNames: async () => [],
      }),
    )

    await engine.query('sales:sales_order_line', {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id', 'line_number'],
      sort: [
        { field: 'line_number', dir: SortDir.Desc },
        { field: 'id', dir: SortDir.Asc },
      ],
      page: { page: 1, pageSize: 10 },
    })

    const baseCall = fakeDb._calls.find((call: any) => call._ops.table === 'sales_order_lines')
    expect(baseCall._ops.orderBys).toEqual([
      ['sales_order_lines.line_number', 'desc'],
      ['sales_order_lines.id', 'asc'],
    ])
  })

  describe('search_tokens coverage probe (#4723 parity)', () => {
    type ProbeDbLog = { _calls: Array<{ _ops: { table: string } }> }

    const countProbes = (fakeDb: ProbeDbLog): number =>
      fakeDb._calls.filter((call) => call._ops.table === 'search_tokens').length

    const buildEngine = (fakeDb: unknown): BasicQueryEngine => new BasicQueryEngine(
      {} as ConstructorParameters<typeof BasicQueryEngine>[0],
      (() => fakeDb) as unknown as NonNullable<ConstructorParameters<typeof BasicQueryEngine>[1]>,
    )

    const buildDb = () => createFakeKysely({
      users: [],
      'information_schema.tables': [{ table_name: 'search_tokens' }],
    })

    test('is skipped when the query carries no like/ilike filter', async () => {
      const fakeDb = buildDb()
      const engine = buildEngine(fakeDb)

      await engine.query('auth:user', {
        tenantId: 't1',
        organizationId: 'org1',
        filters: { is_active: { $eq: true } },
      })

      expect(countProbes(fakeDb)).toBe(0)
    })

    test('still runs when the query actually searches', async () => {
      const fakeDb = buildDb()
      const engine = buildEngine(fakeDb)

      await engine.query('auth:user', {
        tenantId: 't1',
        organizationId: 'org1',
        filters: { email: { $ilike: '%abc%' } },
      })

      expect(countProbes(fakeDb)).toBeGreaterThan(0)
    })
  })
})

describe('BasicQueryEngine entity-extension joins', () => {
  function extensionJoins(fakeDb: any, baseTable: string): any[] {
    const baseCall = fakeDb._calls.find((builder: any) => builder._ops.table === baseTable)
    expect(baseCall).toBeTruthy()
    return baseCall._ops.joins.filter((entry: any) => Object.keys(entry.aliasObj)[0].startsWith('ext_'))
  }

  async function joinFor(entity: string, baseTable: string): Promise<any> {
    const fakeDb = createFakeKysely()
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine.query(entity, {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id'],
      includeExtensions: true,
    })
    const joins = extensionJoins(fakeDb, baseTable)
    expect(joins).toHaveLength(1)
    return joins[0]
  }

  test('prefers a declared table over the derived plural', async () => {
    const join = await joinFor('customers:customer_entity', 'customer_entities')
    expect(join.aliasObj).toEqual({ ext_example_customer_priority: 'example_customer_priorities' })
    expect(join.conditions).toEqual([
      {
        method: 'on',
        args: ['ext_example_customer_priority.customer_id', '=', 'customer_entities.id'],
      },
    ])
  })

  test('falls back to the derived plural when no table is declared', async () => {
    // `policy` ends in `y`, so the correct plural is `policies`. This previously asserted
    // `policys`, pinning a separate inline `+s` pluralizer that the extension-join path used
    // instead of the file's own `pluralizeBaseName` — the very bug that made
    // `example_customer_priority` derive `example_customer_prioritys` and forced the
    // `table` override into existence.
    const join = await joinFor('auth:role', 'roles')
    expect(join.aliasObj).toEqual({ ext_example_role_policy: 'example_role_policies' })
    expect(join.conditions).toEqual([
      { method: 'on', args: ['ext_example_role_policy.role_id', '=', 'roles.id'] },
    ])
  })

  test('ignores a declared table that is not a bare identifier', async () => {
    const join = await joinFor('auth:session', 'sessions')
    expect(join.aliasObj).toEqual({ ext_example_session_note: 'example_session_notes' })
  })
})

describe('BasicQueryEngine like/ilike routing by column encryption', () => {
  // The gate is on by default since #5803, so these cases run with no env var set at all and
  // therefore pin the shipped default; the last one flips it off and pins the legacy
  // rewrite-everything behavior that the escape hatch still has to deliver.
  beforeEach(() => {
    delete process.env.OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS
  })
  afterEach(() => {
    delete process.env.OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS
  })

  // The token rewrite exists because ILIKE against ciphertext cannot match. On a plaintext
  // column SQL ILIKE is exact, and the rewrite silently changes the result set: tokenization
  // splits on non-alphanumerics and drops tokens shorter than minTokenLength, so a
  // document-number search like "ZK 1/2026" degrades to the tokens {202, 2026} and matches
  // every record from that year instead of the one document.
  const fakeDbWithTokens = () => createFakeKysely({
    customer_entities: [],
    search_tokens: [{ one: 1 }],
    'information_schema.tables': [{ table_name: 'search_tokens' }],
    'information_schema.columns': [
      { table_name: 'customer_entities', column_name: 'tenant_id' },
      { table_name: 'customer_entities', column_name: 'display_name' },
    ],
  })

  const ilikePatternsFor = (fakeDb: any, table: string, column: string): string[] => {
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === table)
    if (!baseCall) return []
    return baseCall._ops.wheres
      .filter((w: any) => Array.isArray(w) && String(w[0]).includes(column) && w[1] === 'ilike')
      .map((w: any) => String(w[2]))
  }

  test('a plaintext base column runs as SQL ILIKE even when tokens are available', async () => {
    const fakeDb = fakeDbWithTokens()
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({ getEncryptedFieldNames: async () => [] }) as any,
    )
    const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id'],
      filters: { display_name: { $ilike: '%ZK 1/2026%' } },
      page: { page: 1, pageSize: 10 },
    })

    expect(applySearchTokensSpy).not.toHaveBeenCalled()
    // Multi-word terms are ANDed per word rather than matched as one literal substring -- see the
    // TC-RESO-009 case below for why that distinction is the whole point of the reroute.
    expect(ilikePatternsFor(fakeDb, 'customer_entities', 'display_name')).toEqual(['%ZK%', '%1/2026%'])
  })

  // #5803 regression guard, reported by CI on the first shape of this fix. The token subquery
  // matched a value carrying EVERY token in any order with anything in between, so
  // `?search=Warehouse <stamp>` matched `Warehouse A <stamp>`; TC-RESO-009 pins that as required
  // behavior. One verbatim `ILIKE '%Warehouse <stamp>%'` would not match -- the `A ` sits between
  // the words -- so the reroute has to AND one containment predicate per word to be a fix rather
  // than a trade of one broken search for another.
  test('a multi-word term matches words in order-independent positions, as the token path did', async () => {
    const fakeDb = fakeDbWithTokens()
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({ getEncryptedFieldNames: async () => [] }) as any,
    )

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id'],
      filters: { display_name: { $ilike: '%Warehouse 1757%' } },
      page: { page: 1, pageSize: 10 },
    })

    expect(ilikePatternsFor(fakeDb, 'customer_entities', 'display_name')).toEqual(['%Warehouse%', '%1757%'])
  })

  test('an encrypted base column still routes through search tokens', async () => {
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDbWithTokens() as any,
      () => ({ getEncryptedFieldNames: async () => ['display_name'] }) as any,
    )
    const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id'],
      filters: { display_name: { $ilike: '%avision%' } },
      page: { page: 1, pageSize: 10 },
    })

    expect(applySearchTokensSpy).toHaveBeenCalled()
  })

  test('no service + encryption disabled: nothing is ciphertext, ILIKE stays exact', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    try {
      const fakeDb = fakeDbWithTokens()
      const engine = new BasicQueryEngine({} as any, () => fakeDb as any)
      const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

      await engine.query('customers:customer_entity', {
        tenantId: 't1',
        fields: ['id'],
        filters: { display_name: { $ilike: '%avision%' } },
        page: { page: 1, pageSize: 10 },
      })

      expect(applySearchTokensSpy).not.toHaveBeenCalled()
      const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'customer_entities')
      const ilikeWhere = baseCall._ops.wheres.some(
        (w: any) => Array.isArray(w) && String(w[0]).includes('display_name') && w[1] === 'ilike' && w[2] === '%avision%',
      )
      expect(ilikeWhere).toBe(true)
    } finally {
      delete process.env.TENANT_DATA_ENCRYPTION
    }
  })

  test('no service + encryption enabled: the map is unknown, the token rewrite is kept', async () => {
    // A swallowed DI failure looks exactly like "no service". Guessing "plaintext" here would
    // run ILIKE against ciphertext (zero rows, silently) -- so the gate stays inert instead.
    const engine = new BasicQueryEngine({} as any, () => fakeDbWithTokens() as any)
    const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id'],
      filters: { display_name: { $ilike: '%avision%' } },
      page: { page: 1, pageSize: 10 },
    })

    expect(applySearchTokensSpy).toHaveBeenCalled()
  })

  test('a camelCase encryption-map entry still routes its column through tokens', async () => {
    // Encryption maps may declare `displayName` while the filter carries the column name
    // `display_name` (TenantDataEncryptionService resolves both). A raw name comparison would
    // misread that ciphertext column as plaintext and run ILIKE against ciphertext -- zero rows,
    // silently. The gate must match across name shapes.
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDbWithTokens() as any,
      () => ({ getEncryptedFieldNames: async () => ['displayName'] }) as any,
    )
    const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id'],
      filters: { display_name: { $ilike: '%avision%' } },
      page: { page: 1, pageSize: 10 },
    })

    expect(applySearchTokensSpy).toHaveBeenCalled()
  })

  // #5803: the reported regression. `2026-08` and `2026-01` tokenize to the identical set
  // {202, 2026} because the fragment that tells them apart is shorter than minTokenLength, so the
  // token rewrite answered a search for one period with the other one. The declared predicate has
  // to reach SQL verbatim for the exact row to come back at all.
  test('a search term whose distinguishing fragment is dropped by the tokenizer still reaches SQL verbatim', async () => {
    const fakeDb = createFakeKysely({
      accounting_periods: [],
      search_tokens: [{ one: 1 }],
      'information_schema.tables': [{ table_name: 'search_tokens' }],
      'information_schema.columns': [
        { table_name: 'accounting_periods', column_name: 'tenant_id' },
        { table_name: 'accounting_periods', column_name: 'period_code' },
      ],
    })
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({ getEncryptedFieldNames: async () => [] }) as any,
    )
    const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

    await engine.query('accounting:accounting_period', {
      tenantId: 't1',
      fields: ['id'],
      filters: { period_code: { $ilike: '%2026-08%' } },
      page: { page: 1, pageSize: 10 },
    })

    expect(applySearchTokensSpy).not.toHaveBeenCalled()
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'accounting_periods')
    expect(baseCall).toBeTruthy()
    const ilikeWhere = baseCall._ops.wheres.some(
      (w: any) => Array.isArray(w) && String(w[0]).includes('period_code') && w[1] === 'ilike' && w[2] === '%2026-08%',
    )
    expect(ilikeWhere).toBe(true)
  })

  // #5803: `08` tokenizes to nothing at all, and the token path answered that with "no predicate"
  // -- every row in the table. A filter that matches everything is never the honest reading of a
  // declared containment predicate.
  test('a term too short to tokenize filters instead of being dropped', async () => {
    const fakeDb = fakeDbWithTokens()
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({ getEncryptedFieldNames: async () => [] }) as any,
    )

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id'],
      filters: { display_name: { $ilike: '%08%' } },
      page: { page: 1, pageSize: 10 },
    })

    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'customer_entities')
    const ilikeWhere = baseCall._ops.wheres.some(
      (w: any) => Array.isArray(w) && String(w[0]).includes('display_name') && w[1] === 'ilike' && w[2] === '%08%',
    )
    expect(ilikeWhere).toBe(true)
  })

  test('with the flag explicitly off the token rewrite is kept even for plaintext columns', () => {
    process.env.OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS = 'false'
    const fakeDb = fakeDbWithTokens()
    const engine = new BasicQueryEngine(
      {} as any,
      () => fakeDb as any,
      () => ({ getEncryptedFieldNames: async () => [] }) as any,
    )
    const applySearchTokensSpy = jest.spyOn(engine as any, 'applySearchTokens')

    return engine
      .query('customers:customer_entity', {
        tenantId: 't1',
        fields: ['id'],
        filters: { display_name: { $ilike: '%avision%' } },
        page: { page: 1, pageSize: 10 },
      })
      .then(() => {
        expect(applySearchTokensSpy).toHaveBeenCalled()
      })
  })
})

describe('module-scoped column-existence cache (#5605)', () => {
  const columnProbes = (fakeDb: any) =>
    fakeDb._calls.filter((b: any) => b._ops.table === 'information_schema.columns')

  const columnProbesFor = (fakeDb: any, column: string) =>
    columnProbes(fakeDb).filter((b: any) =>
      b._ops.wheres.some((w: any) => Array.isArray(w) && w[0] === 'column_name' && w[1] === '=' && w[2] === column)
    )

  const hasTenantGuard = (fakeDb: any) => {
    const baseCall = fakeDb._calls.find((b: any) => b._ops.table === 'customer_entities')
    return !!baseCall?._ops.wheres.some(
      (w: any) => Array.isArray(w) && w[0] === 'customer_entities.tenant_id' && w[1] === '=' && w[2] === 't1',
    )
  }

  const originalTtl = process.env.OM_QUERY_COLUMN_EXISTS_CACHE_MS
  const originalMaxEntries = process.env.OM_QUERY_COLUMN_EXISTS_CACHE_MAX_ENTRIES

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.OM_QUERY_COLUMN_EXISTS_CACHE_MS
    else process.env.OM_QUERY_COLUMN_EXISTS_CACHE_MS = originalTtl
    if (originalMaxEntries === undefined) delete process.env.OM_QUERY_COLUMN_EXISTS_CACHE_MAX_ENTRIES
    else process.env.OM_QUERY_COLUMN_EXISTS_CACHE_MAX_ENTRIES = originalMaxEntries
    jest.restoreAllMocks()
  })

  test('the column-existence cache is shared across separate engine instances', async () => {
    // `createRequestContainer()` builds a fresh `BasicQueryEngine` per HTTP request.
    // The cache must live on the module, not the instance, so a later "request" (a
    // second engine here) reuses the first request's answer instead of re-probing
    // `information_schema.columns`.
    const fakeDb = createFakeKysely({
      customer_entities: [],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'tenant_id' },
      ],
    })
    const queryOpts = { tenantId: 't1', fields: ['id'], page: { page: 1, pageSize: 10 } }

    const engine1 = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine1.query('customers:customer_entity', queryOpts)
    const probesAfterFirstEngine = columnProbes(fakeDb).length
    expect(probesAfterFirstEngine).toBeGreaterThan(0)

    const engine2 = new BasicQueryEngine({} as any, () => fakeDb as any)
    await engine2.query('customers:customer_entity', queryOpts)
    expect(columnProbes(fakeDb).length).toBe(probesAfterFirstEngine)
  })

  test('a missing column is remembered as false instead of being re-queried on every call', async () => {
    // Before the fix, `columnExists` deleted a `false` result instead of caching it,
    // so `organization_id` (absent here) was re-queried once per query projection
    // ('full' and 'count') within a single `.query()` call.
    const fakeDb = createFakeKysely({
      customer_entities: [],
      'information_schema.columns': [],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id'],
      page: { page: 1, pageSize: 10 },
    })

    expect(columnProbesFor(fakeDb, 'organization_id').length).toBe(1)
  })

  test('a cached negative expires, so a migrated-in scope column is picked up without a process restart', async () => {
    // A cached `false` is consumed where the tenant/organization/soft-delete predicates
    // are applied, so a stale one does not merely slow a query down — it silently drops
    // a scope guard. The TTL bounds that window: a migration applied against a running
    // process (`yarn dev`, or pods not recycled by a separate migration release step)
    // converges once the entry expires instead of never.
    const now = 1_700_000_000_000
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now)

    const beforeMigration = createFakeKysely({
      customer_entities: [],
      'information_schema.columns': [],
    })
    const queryOpts = { tenantId: 't1', fields: ['id'], page: { page: 1, pageSize: 10 } }
    await new BasicQueryEngine({} as any, () => beforeMigration as any).query('customers:customer_entity', queryOpts)
    expect(columnProbesFor(beforeMigration, 'tenant_id').length).toBe(1)
    expect(hasTenantGuard(beforeMigration)).toBe(false)

    // Same process, same cache — a second request while the entry is still fresh reuses
    // the negative and does not re-probe, even though the column now exists.
    const afterMigration = createFakeKysely({
      customer_entities: [],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'tenant_id' },
      ],
    })
    await new BasicQueryEngine({} as any, () => afterMigration as any).query('customers:customer_entity', queryOpts)
    expect(columnProbesFor(afterMigration, 'tenant_id').length).toBe(0)
    expect(hasTenantGuard(afterMigration)).toBe(false)

    nowSpy.mockReturnValue(now + 300_001)

    const afterTtl = createFakeKysely({
      customer_entities: [],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'tenant_id' },
      ],
    })
    await new BasicQueryEngine({} as any, () => afterTtl as any).query('customers:customer_entity', queryOpts)
    expect(columnProbesFor(afterTtl, 'tenant_id').length).toBe(1)
    expect(hasTenantGuard(afterTtl)).toBe(true)
  })

  test('the cache is bounded, so caller-supplied sort fields cannot grow it without limit', async () => {
    // `columnExists` is reached with raw request input through `resolveBaseColumn` —
    // `sortField` arrives from the query string and many list schemas type it as a plain
    // string. Without a cap, one distinct name per request would be retained for the
    // lifetime of the process.
    process.env.OM_QUERY_COLUMN_EXISTS_CACHE_MAX_ENTRIES = '4'
    const fakeDb = createFakeKysely({
      customer_entities: [],
      'information_schema.columns': [],
    })
    const engine = new BasicQueryEngine({} as any, () => fakeDb as any)

    for (let index = 0; index < 20; index += 1) {
      await engine.query('customers:customer_entity', {
        tenantId: 't1',
        fields: ['id'],
        sort: [{ field: `attacker_supplied_${index}`, dir: SortDir.Asc }],
        page: { page: 1, pageSize: 10 },
      })
      expect(columnExistsCacheSize()).toBeLessThanOrEqual(4)
    }
  })

  test('OM_QUERY_COLUMN_EXISTS_CACHE_MS=0 disables the memo and probes per request again', async () => {
    process.env.OM_QUERY_COLUMN_EXISTS_CACHE_MS = '0'
    const fakeDb = createFakeKysely({
      customer_entities: [],
      'information_schema.columns': [
        { table_name: 'customer_entities', column_name: 'tenant_id' },
      ],
    })
    const queryOpts = { tenantId: 't1', fields: ['id'], page: { page: 1, pageSize: 10 } }

    await new BasicQueryEngine({} as any, () => fakeDb as any).query('customers:customer_entity', queryOpts)
    const probesAfterFirstEngine = columnProbesFor(fakeDb, 'tenant_id').length
    expect(probesAfterFirstEngine).toBeGreaterThan(0)
    expect(columnExistsCacheSize()).toBe(0)

    await new BasicQueryEngine({} as any, () => fakeDb as any).query('customers:customer_entity', queryOpts)
    expect(columnProbesFor(fakeDb, 'tenant_id').length).toBeGreaterThan(probesAfterFirstEngine)
  })
})
