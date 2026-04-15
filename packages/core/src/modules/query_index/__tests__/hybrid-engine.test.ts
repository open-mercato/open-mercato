import { HybridQueryEngine } from '../../query_index/lib/engine'

type KyselyMockConfig = {
  baseTable: string
  hasIndexAny: boolean
  baseCount: number
  indexCount: number
  customFieldKeys?: Record<string, string[]>
  /** If provided, returned for information_schema.columns lookups. */
  columns?: Array<{ table_name: string; column_name: string }>
}

type ChainLog = {
  table: string
  selects: any[]
  wheres: any[]
  joins: Array<{ kind: 'left' | 'inner'; table: string }>
  orderBys: any[]
  groupBys: any[]
  havings: any[]
  limit: number | null
  offset: number | null
}

const DEFAULT_CF_KEYS: Record<string, string[]> = {
  'example:todo': ['priority'],
  'customers:customer_entity': ['sector'],
  'customers:customer_person_profile': ['birthday'],
  'customers:customer_company_profile': ['industry'],
}

/**
 * Pure Kysely test double for HybridQueryEngine. Returns pre-configured rows per
 * `selectFrom(table)` and accumulates every chain operation in `_chains` so
 * behavioural assertions can peek at the compiled shape when needed.
 */
function createFakeKysely(config: KyselyMockConfig) {
  const chains: ChainLog[] = []
  const customFieldKeys = config.customFieldKeys ?? DEFAULT_CF_KEYS

  const makeChain = (rawTable: string): any => {
    const table = rawTable.split(/\s+as\s+/i)[0].trim()
    const log: ChainLog = {
      table, selects: [], wheres: [], joins: [],
      orderBys: [], groupBys: [], havings: [],
      limit: null, offset: null,
    }
    chains.push(log)

    const chain: any = {
      _log: log,
      select: (...cols: any[]) => { log.selects.push(...cols); return chain },
      selectAll: () => { log.selects.push('*'); return chain },
      distinct: () => chain,
      where: (...args: any[]) => {
        // Capture just the raw args (Kysely expression callbacks are opaque).
        log.wheres.push(args)
        return chain
      },
      orderBy: (...args: any[]) => { log.orderBys.push(args); return chain },
      groupBy: (...cols: any[]) => { log.groupBys.push(...cols); return chain },
      having: (...args: any[]) => { log.havings.push(args); return chain },
      limit: (n: number) => { log.limit = n; return chain },
      offset: (n: number) => { log.offset = n; return chain },
      leftJoin: (target: any, _on: any) => {
        const name = typeof target === 'string' ? target.split(/\s+as\s+/i).pop()!.trim() : String(target)
        log.joins.push({ kind: 'left', table: name })
        return chain
      },
      innerJoin: (target: any, _on: any) => {
        const name = typeof target === 'string' ? target.split(/\s+as\s+/i).pop()!.trim() : String(target)
        log.joins.push({ kind: 'inner', table: name })
        return chain
      },
      as: (_alias: string) => chain,
      compile: () => ({ sql: `/* ${table} */`, parameters: [] }),

      executeTakeFirst: async () => resolveFirstRow(table, log, config, customFieldKeys),
      execute: async () => resolveRows(table, log, config, customFieldKeys),
    }
    return chain
  }

  const makeMutatingChain = (kind: 'insert' | 'update' | 'delete'): any => {
    const chain: any = {
      values: () => chain,
      set: () => chain,
      where: () => chain,
      onConflict: () => chain,
      returning: () => chain,
      execute: async () => (kind === 'insert' ? [{ id: 'mock' }] : []),
      executeTakeFirst: async () => (kind === 'insert'
        ? { id: 'mock', numInsertedOrUpdatedRows: 1 }
        : { numUpdatedRows: 0, numDeletedRows: 0 }),
    }
    return chain
  }

  const db: any = {
    _chains: chains,
    selectFrom: (table: any) => makeChain(String(table)),
    insertInto: () => makeMutatingChain('insert'),
    updateTable: () => makeMutatingChain('update'),
    deleteFrom: () => makeMutatingChain('delete'),
    transaction: () => ({ execute: async (fn: any) => fn(db) }),
  }
  return db
}

function resolveFirstRow(
  table: string,
  log: ChainLog,
  config: KyselyMockConfig,
  customFieldKeys: Record<string, string[]>,
): any {
  if (table === 'information_schema.tables') {
    const lookingFor = log.wheres
      .flatMap((entry: any[]) => entry)
      .find((arg: any) => typeof arg === 'string')
    // Any table_name lookup is satisfied if it matches baseTable or is our service table.
    return lookingFor ? { one: 1 } : undefined
  }
  if (table === 'information_schema.columns') {
    // Collect column/table names from the captured wheres to match the requested pair.
    const args = log.wheres.flatMap((entry: any[]) => entry)
    const tableName = args[args.indexOf('table_name') + 2] as string | undefined
    const columnName = args[args.indexOf('column_name') + 2] as string | undefined
    if (config.columns && tableName && columnName) {
      const match = config.columns.find(
        (col) => col.table_name === tableName && col.column_name === columnName,
      )
      return match ? { one: 1 } : undefined
    }
    // Default: report that common columns exist so scope filters can apply.
    if (columnName === 'organization_id' || columnName === 'tenant_id' || columnName === 'deleted_at' || columnName === 'id') {
      return { one: 1 }
    }
    return undefined
  }
  if (table === 'entity_index_coverage') {
    if (!config.hasIndexAny) return undefined
    return {
      base_count: String(config.baseCount),
      indexed_count: String(config.indexCount),
      vector_indexed_count: null,
      refreshed_at: new Date(),
      organization_id: null,
    }
  }
  if (table === 'entity_indexes') {
    return config.hasIndexAny ? { entity_id: 'x' } : undefined
  }
  if (table === 'custom_entities') {
    return undefined
  }
  // Count subquery / data reads: look for `count` alias in selects.
  const hasCount = log.selects.some((s: any) => {
    try { return String(s?.name ?? s) === 'count' || typeof s?.as === 'function' } catch { return false }
  })
  if (hasCount) return { count: String(config.baseCount) }
  return undefined
}

function resolveRows(
  table: string,
  log: ChainLog,
  config: KyselyMockConfig,
  customFieldKeys: Record<string, string[]>,
): any[] {
  if (table === 'custom_field_defs') {
    // Flatten all wheres, grab the `entity_id in [...]` arg if present.
    const args = log.wheres.flatMap((entry: any[]) => entry)
    const inIdx = args.findIndex((a: any, i: number) => a === 'entity_id' && args[i + 1] === 'in')
    const requestedEntities: string[] = inIdx >= 0 && Array.isArray(args[inIdx + 2])
      ? (args[inIdx + 2] as string[])
      : Object.keys(customFieldKeys)
    return requestedEntities.flatMap((entityId) =>
      (customFieldKeys[entityId] ?? []).map((key) => ({ entity_id: entityId, key, is_active: true })),
    )
  }
  if (table === 'information_schema.columns') {
    if (config.columns) {
      const args = log.wheres.flatMap((entry: any[]) => entry)
      const tableName = args[args.indexOf('table_name') + 2] as string | undefined
      return config.columns
        .filter((col) => col.table_name === tableName)
        .map((col) => ({ column_name: col.column_name, data_type: 'text' }))
    }
    return [
      { column_name: 'id', data_type: 'uuid' },
      { column_name: 'tenant_id', data_type: 'uuid' },
      { column_name: 'organization_id', data_type: 'uuid' },
      { column_name: 'deleted_at', data_type: 'timestamp' },
    ]
  }
  return []
}

function buildEm(db: any): any {
  return { getKysely: () => db }
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
    const db = createFakeKysely({ baseTable: 'todos', hasIndexAny: false, baseCount: 5, indexCount: 0 })
    const em = buildEm(db)
    const fallback = { query: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }) }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))

    await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1' })
    expect(fallback.query).toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  test('falls back and warns on partial coverage', async () => {
    process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES = 'false'
    const db = createFakeKysely({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 1 })
    const em = buildEm(db)
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
    const db = createFakeKysely({
      baseTable: 'todos', hasIndexAny: true, baseCount: 8, indexCount: 2, customFieldKeys: {},
    })
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await engine.query('example:todo', {
      fields: ['id'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1',
    })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(result.meta?.partialIndexWarning).toBeUndefined()
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('emits partial coverage metadata when forcing query index usage', async () => {
    process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES = 'true'
    const db = createFakeKysely({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 4 })
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await engine.query('example:todo', {
      fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1',
    })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(result.meta?.partialIndexWarning).toEqual(expect.objectContaining({ entity: 'example:todo' }))
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('does not fall back on partial coverage when only projecting base fields', async () => {
    const db = createFakeKysely({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 4 })
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await engine.query('example:todo', {
      fields: ['id'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1',
    })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('emits partial coverage metadata when global scope is out of sync', async () => {
    process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES = 'true'
    const db = createFakeKysely({ baseTable: 'todos', hasIndexAny: true, baseCount: 5, indexCount: 5 })
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))

    jest.spyOn(engine as any, 'indexCoverageStats')
      .mockImplementationOnce(async () => ({ baseCount: 5, indexedCount: 5 }))
      .mockImplementationOnce(async () => ({ baseCount: 10, indexedCount: 7 }))

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await engine.query('example:todo', {
      fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1',
    })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(result.meta?.partialIndexWarning).toEqual(expect.objectContaining({ entity: 'example:todo', scope: 'global' }))
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('propagates partial coverage metadata from custom field sources', async () => {
    process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES = 'true'
    const db = createFakeKysely({ baseTable: 'customer_entities', hasIndexAny: true, baseCount: 5, indexCount: 5 })
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))

    const originalResolve = (engine as any).resolveCoverageGap.bind(engine)
    jest.spyOn(engine as any, 'resolveCoverageGap')
      .mockImplementationOnce(originalResolve)
      .mockImplementationOnce(async () => ({ stats: { baseCount: 8, indexedCount: 6 }, scope: 'scoped' }))
      .mockImplementation(originalResolve)

    const result = await engine.query('customers:customer_entity', {
      tenantId: 't1', organizationId: 'org1',
      fields: ['id', 'cf:birthday'],
      includeCustomFields: ['birthday'],
      customFieldSources: [{
        entityId: 'customers:customer_person_profile',
        table: 'customer_people', alias: 'person_profile',
        recordIdColumn: 'id',
        join: { fromField: 'id', toField: 'entity_id' },
      }],
      page: { page: 1, pageSize: 10 },
    })

    expect(result.meta?.partialIndexWarning).toEqual(expect.objectContaining({ entity: 'customers:customer_person_profile' }))
  })

  test('detects mismatch when index count exceeds base count', async () => {
    process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES = 'true'
    const db = createFakeKysely({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 12 })
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await engine.query('example:todo', {
      fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1',
    })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(result.meta?.partialIndexWarning).toEqual(expect.objectContaining({ entity: 'example:todo' }))
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('uses hybrid path when coverage is complete', async () => {
    const db = createFakeKysely({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 10 })
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))

    await engine.query('example:todo', {
      fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1',
      page: { page: 1, pageSize: 5 },
    })
    expect(fallback.query).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  test('joins entity index aliases for customFieldSources', async () => {
    const db = createFakeKysely({ baseTable: 'customer_entities', hasIndexAny: true, baseCount: 5, indexCount: 5 })
    const em = buildEm(db)
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
          table: 'customer_people', alias: 'person_profile',
          recordIdColumn: 'id',
          join: { fromField: 'id', toField: 'entity_id' },
        },
        {
          entityId: 'customers:customer_company_profile',
          table: 'customer_companies', alias: 'company_profile',
          recordIdColumn: 'id',
          join: { fromField: 'id', toField: 'entity_id' },
        },
      ],
      page: { page: 1, pageSize: 10 },
    })

    expect(fallback.query).not.toHaveBeenCalled()
    // Inspect the data/count queries for the `customer_entities` base table:
    // each should carry the `ei` + per-source (`person_profile` / `company_profile`) joins.
    const baseQueries = (db._chains as ChainLog[]).filter((c) => c.table === 'customer_entities')
    const allJoinTables = baseQueries.flatMap((c) => c.joins.map((j) => j.table))
    expect(allJoinTables).toEqual(expect.arrayContaining([
      'ei', 'person_profile', 'ei_person_profile', 'company_profile', 'ei_company_profile',
    ]))
    expect(emitEvent).not.toHaveBeenCalled()
  })

  test('does not auto reindex when disabled via env', async () => {
    process.env.QUERY_INDEX_AUTO_REINDEX = 'false'
    const db = createFakeKysely({ baseTable: 'todos', hasIndexAny: true, baseCount: 10, indexCount: 1 })
    const em = buildEm(db)
    const fallback = { query: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }) }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await engine.query('example:todo', { fields: ['id', 'cf:priority'], includeCustomFields: true, organizationId: 'org1', tenantId: 't1' })
    // The auto-reindex event (`query_index.reindex`) should not fire.
    const reindexCalls = emitEvent.mock.calls.filter(([name]) => name === 'query_index.reindex')
    expect(reindexCalls).toHaveLength(0)
    warnSpy.mockRestore()
  })
})
