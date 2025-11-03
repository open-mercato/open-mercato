import { HybridQueryEngine } from '../../query_index/lib/engine'

function createFakeKnex(config: {
  baseTable: string
  hasIndexAny: boolean
  baseCount: number
  indexCount: number
  customFieldKeys?: Record<string, string[]>
}) {
  const defaultCustomFieldKeys: Record<string, string[]> = {
    'example:todo': ['priority'],
    'customers:customer_entity': ['sector'],
    'customers:customer_person_profile': ['birthday'],
    'customers:customer_company_profile': ['industry'],
  }
  const customFieldKeys = config.customFieldKeys ?? defaultCustomFieldKeys
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
    const ops = { table, alias, wheres: [] as any[], joins: [] as any[], selects: [] as any[], orderBys: [] as any[], limits: 0, offsets: 0, isCountDistinct: false, isCount: false }
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
      modify: function (fn: (qb: any) => void) { if (typeof fn === 'function') fn(this); return this },
      clearSelect: function () { ops.selects = []; return this },
      clearOrder: function () { ops.orderBys = []; return this },
      clone: function () { return this },
      as: function (_alias: string) { return table },
      countDistinct: function () { ops.isCountDistinct = true; return this },
      count: function () { ops.isCount = true; return this },
      first: async function () {
        if (table === 'information_schema.tables') {
          return { table_name: config.baseTable }
        }
        if (table === 'entity_index_coverage') {
          if (!config.hasIndexAny) return undefined
          const requiresPositive = ops.wheres.some(
            (entry) =>
              Array.isArray(entry) &&
              entry.length >= 3 &&
              entry[0] === 'indexed_count' &&
              entry[1] === '>' &&
              Number(entry[2]) > 0,
          )
          if (requiresPositive && config.indexCount <= 0) return undefined
          return {
            base_count: String(config.baseCount),
            indexed_count: String(config.indexCount),
            refreshed_at: new Date(),
          }
        }
        if (table === 'entity_indexes' && !ops.isCountDistinct) {
          return config.hasIndexAny ? { entity_type: 'x' } : undefined
        }
        if (ops.isCountDistinct) {
          if (table === config.baseTable || ops.alias === 'b') return { count: String(config.baseCount) }
          if (table === 'entity_indexes' || ops.alias === 'ei') return { count: String(config.indexCount) }
          return { count: '0' }
        }
        if (ops.isCount) {
          return { count: String(config.baseCount) }
        }
        return undefined
      },
      then: function (resolve: any, reject?: any) {
        try {
          let result: any[] = []
          if (table === 'custom_field_defs') {
            const entityWhere = ops.wheres.find((entry) => Array.isArray(entry) && entry[0] === 'in' && entry[1] === 'entity_id')
            const requestedEntities: string[] = Array.isArray(entityWhere?.[2])
              ? (entityWhere![2] as any[]).map((id) => String(id))
              : Object.keys(customFieldKeys)
            result = requestedEntities.flatMap((entityId) => {
              const keys = customFieldKeys[entityId] ?? []
              return keys.map((key) => ({ entity_id: entityId, key, is_active: true }))
            })
          }
          return Promise.resolve(resolve(result))
        } catch (err) {
          if (reject) return Promise.resolve(reject(err))
          return Promise.reject(err)
        }
      },
      raw,
    }
    calls.push(b)
    return b
  }
  const fn: any = (t: any) => builderFor(t)
  fn.raw = raw
  fn.from = (t: any) => builderFor(t)
  fn._calls = calls
  return fn
}

describe('HybridQueryEngine', () => {
  const originalAutoReindex = process.env.QUERY_INDEX_AUTO_REINDEX
  const originalForcePartial = process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES

  beforeEach(() => {
    delete process.env.QUERY_INDEX_AUTO_REINDEX
    delete process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES
  })

  afterEach(() => {
    if (originalAutoReindex === undefined) delete process.env.QUERY_INDEX_AUTO_REINDEX
    else process.env.QUERY_INDEX_AUTO_REINDEX = originalAutoReindex
    if (originalForcePartial === undefined) delete process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES
    else process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES = originalForcePartial
    jest.clearAllMocks()
  })

  test('falls back when wantsCf but no index rows exist', async () => {
    const fakeKnex = createFakeKnex({ baseTable: 'todos', hasIndexAny: false, baseCount: 5, indexCount: 0 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }) }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))

    await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1' })
    expect(fallback.query).toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  test('falls back and warns on partial coverage', async () => {
    process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES = 'false'
    const fakeKnex = createFakeKnex({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 1 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }) }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1' })
    expect(fallback.query).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    const msg = (warnSpy.mock.calls[0] || [])[0] as string
    expect(msg).toContain('Partial index coverage')
    expect(emitEvent).toHaveBeenCalledWith(
      'query_index.reindex',
      expect.objectContaining({ entityType: 'example:todo', tenantId: 't1', organizationId: 'org1', force: false }),
      { persistent: true },
    )
    warnSpy.mockRestore()
  })

  test('skips partial coverage warning when entity has no custom fields', async () => {
    const fakeKnex = createFakeKnex({
      baseTable: 'todos',
      hasIndexAny: true,
      baseCount: 8,
      indexCount: 2,
      customFieldKeys: {},
    })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await engine.query('example:todo', {
      fields: ['id'],
      includeCustomFields: true,
      organizationId: 'org1',
      tenantId: 't1',
    })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(result.meta?.partialIndexWarning).toBeUndefined()
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  test('emits partial coverage metadata when forcing query index usage', async () => {
    const fakeKnex = createFakeKnex({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 4 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1' })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(result.meta?.partialIndexWarning).toEqual(expect.objectContaining({ entity: 'example:todo' }))
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('emits partial coverage metadata when global scope is out of sync', async () => {
    const fakeKnex = createFakeKnex({ baseTable: 'todos', hasIndexAny: true, baseCount: 5, indexCount: 5 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))

    const statsSpy = jest
      .spyOn(engine as any, 'indexCoverageStats')
      .mockImplementationOnce(async () => ({ baseCount: 5, indexedCount: 5 })) // scoped ok
      .mockImplementationOnce(async () => ({ baseCount: 10, indexedCount: 7 })) // global mismatch

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1' })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(result.meta?.partialIndexWarning).toEqual(expect.objectContaining({ entity: 'example:todo', scope: 'global' }))
    expect(warnSpy).toHaveBeenCalled()

    statsSpy.mockRestore()
    warnSpy.mockRestore()
  })

  test('propagates partial coverage metadata from custom field sources', async () => {
    const fakeKnex = createFakeKnex({ baseTable: 'customer_entities', hasIndexAny: true, baseCount: 5, indexCount: 5 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))

    const originalResolve = (engine as any).resolveCoverageGap.bind(engine)
    const gapSpy = jest
      .spyOn(engine as any, 'resolveCoverageGap')
      .mockImplementationOnce(originalResolve)
      .mockImplementationOnce(async () => ({ stats: { baseCount: 8, indexedCount: 6 }, scope: 'scoped' }))
      .mockImplementation(originalResolve)

    const result = await engine.query('customers:customer_entity', {
      tenantId: 't1',
      organizationId: 'org1',
      fields: ['id', 'cf:birthday'],
      includeCustomFields: ['birthday'],
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

    expect(result.meta?.partialIndexWarning).toEqual(expect.objectContaining({ entity: 'customers:customer_person_profile' }))
    expect(gapSpy).toHaveBeenCalled()
    gapSpy.mockRestore()
  })

  test('detects mismatch when index count exceeds base count', async () => {
    const fakeKnex = createFakeKnex({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 12 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1' })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(result.meta?.partialIndexWarning).toEqual(expect.objectContaining({ entity: 'example:todo' }))
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('uses hybrid path when coverage complete', async () => {
    const fakeKnex = createFakeKnex({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 10 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))

    await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1', page: { page: 1, pageSize: 5 } })
    expect(fallback.query).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  test('joins entity index aliases for customFieldSources', async () => {
    const fakeKnex = createFakeKnex({ baseTable: 'customer_entities', hasIndexAny: true, baseCount: 5, indexCount: 5 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))

    await engine.query('customers:customer_entity', {
      tenantId: 't1',
      fields: ['id', 'cf:birthday', 'cf:sector'],
      includeCustomFields: ['birthday', 'sector'],
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

    expect(fallback.query).not.toHaveBeenCalled()
    const baseCall = fakeKnex._calls.find((call: any) => call._ops.alias === 'b')
    expect(baseCall).toBeTruthy()
    const summary = fakeKnex._calls.map((call: any) => ({
      alias: call._ops.alias,
      joinAliases: call._ops.joins.map((join: any) => Object.keys(join.aliasObj)[0]),
    }))
    expect(summary).toEqual(expect.arrayContaining([
      expect.objectContaining({
        alias: 'b',
        joinAliases: expect.arrayContaining([
          'ei',
          'person_profile',
          'ei_person_profile',
          'company_profile',
          'ei_company_profile',
        ]),
      }),
    ]))
    expect(emitEvent).not.toHaveBeenCalled()
  })

  test('does not auto reindex when disabled via env', async () => {
    process.env.QUERY_INDEX_AUTO_REINDEX = 'false'
    const fakeKnex = createFakeKnex({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 1 })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const fallback = { query: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }) }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1' })
    expect(emitEvent).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
