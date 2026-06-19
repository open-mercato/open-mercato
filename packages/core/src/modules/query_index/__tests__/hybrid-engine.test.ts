import { HybridQueryEngine, coerceSortDirection } from '../../query_index/lib/engine'
import { SortDir } from '@open-mercato/shared/lib/query/types'

type KyselyMockConfig = {
  baseTable: string
  hasIndexAny: boolean
  baseCount: number
  indexCount: number
  coverageRefreshedAt?: Date | string | null
  customFieldKeys?: Record<string, string[]>
  rows?: Record<string, Array<Record<string, unknown>>>
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

type MutationLog = {
  kind: 'insert' | 'update' | 'delete'
  table: string
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
  const mutations: MutationLog[] = []
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

  const makeMutatingChain = (kind: 'insert' | 'update' | 'delete', rawTable: string): any => {
    const table = rawTable.split(/\s+as\s+/i)[0].trim()
    mutations.push({ kind, table })
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
    _mutations: mutations,
    selectFrom: (table: any) => makeChain(String(table)),
    insertInto: (table: any) => makeMutatingChain('insert', String(table)),
    updateTable: (table: any) => makeMutatingChain('update', String(table)),
    deleteFrom: (table: any) => makeMutatingChain('delete', String(table)),
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
    const refreshedAt = Object.prototype.hasOwnProperty.call(config, 'coverageRefreshedAt')
      ? config.coverageRefreshedAt
      : new Date()
    return {
      base_count: String(config.baseCount),
      indexed_count: String(config.indexCount),
      vector_indexed_count: null,
      refreshed_at: refreshedAt,
      organization_id: null,
    }
  }
  if (table === 'custom_entities_storage' && log.limit === 1) {
    // Existence probe used by isCustomEntity/hasCustomEntityStorageRows.
    return (config.rows?.custom_entities_storage ?? []).length ? { one: 1 } : undefined
  }
  // Count subquery / data reads: look for `count` alias in selects. Kysely's
  // `AliasedRawBuilderImpl` exposes the alias via a getter named `alias`
  // (not `name`), and never re-exposes `.as`.
  const hasCount = log.selects.some((s: any) => {
    try { return String(s?.alias ?? s) === 'count' } catch { return false }
  })
  if (hasCount) return { count: String(table === 'entity_indexes' ? config.indexCount : config.baseCount) }
  if (table === 'entity_indexes') {
    return config.hasIndexAny ? { entity_id: 'x' } : undefined
  }
  if (table === 'custom_entities') {
    return undefined
  }
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
  if (config.rows?.[table]) {
    return config.rows[table]
  }
  return []
}

function buildEm(db: any): any {
  return { getKysely: () => db }
}

function buildEmWithOrmMetadata(db: any, classTables: Record<string, string>): any {
  return {
    getKysely: () => db,
    getMetadata: () => ({
      find: (className: string) => (classTables[className] ? { tableName: classTables[className] } : undefined),
      getAll: () => Object.values(classTables).map((tableName) => ({ tableName })),
    }),
  }
}

describe('HybridQueryEngine', () => {
  const originalAutoReindex = process.env.QUERY_INDEX_AUTO_REINDEX
  const originalForcePartial = process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES
  const originalCoverageTtl = process.env.QUERY_INDEX_COVERAGE_CACHE_MS
  const originalCoverageOptimization = process.env.OPTIMIZE_INDEX_COVERAGE_STATS

  beforeEach(() => {
    delete process.env.QUERY_INDEX_AUTO_REINDEX
    delete process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES
    delete process.env.QUERY_INDEX_COVERAGE_CACHE_MS
    delete process.env.OPTIMIZE_INDEX_COVERAGE_STATS
  })

  afterEach(() => {
    if (originalAutoReindex === undefined) delete process.env.QUERY_INDEX_AUTO_REINDEX
    else process.env.QUERY_INDEX_AUTO_REINDEX = originalAutoReindex
    if (originalForcePartial === undefined) delete process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES
    else process.env.FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES = originalForcePartial
    if (originalCoverageTtl === undefined) delete process.env.QUERY_INDEX_COVERAGE_CACHE_MS
    else process.env.QUERY_INDEX_COVERAGE_CACHE_MS = originalCoverageTtl
    if (originalCoverageOptimization === undefined) delete process.env.OPTIMIZE_INDEX_COVERAGE_STATS
    else process.env.OPTIMIZE_INDEX_COVERAGE_STATS = originalCoverageOptimization
    jest.clearAllMocks()
  })

  test('serves fresh coverage snapshots without recomputing coverage counts', async () => {
    process.env.QUERY_INDEX_COVERAGE_CACHE_MS = '300000'
    const db = createFakeKysely({
      baseTable: 'todos',
      hasIndexAny: true,
      baseCount: 10,
      indexCount: 4,
      coverageRefreshedAt: new Date(),
    })
    const engine = new HybridQueryEngine(buildEm(db), { query: jest.fn() } as any)

    const snapshot = await (engine as any).getStoredCoverageSnapshot('example:todo', 't1', 'org1', false)

    expect(snapshot).toEqual({ baseCount: 10, indexedCount: 4 })
    expect((db._chains as ChainLog[]).some((chain) => chain.table === 'todos')).toBe(false)
    expect((db._chains as ChainLog[]).some((chain) => chain.table === 'entity_indexes' && chain.selects.length > 0)).toBe(false)
    expect(db._mutations).toEqual([])
  })

  test('synchronously refreshes stale coverage snapshots when optimization flag is disabled', async () => {
    process.env.QUERY_INDEX_COVERAGE_CACHE_MS = '1000'
    const db = createFakeKysely({
      baseTable: 'todos',
      hasIndexAny: true,
      baseCount: 10,
      indexCount: 4,
      coverageRefreshedAt: new Date(Date.now() - 10_000),
    })
    const engine = new HybridQueryEngine(buildEm(db), { query: jest.fn() } as any)

    const snapshot = await (engine as any).getStoredCoverageSnapshot('example:todo', 't1', 'org1', false)

    expect(snapshot).toEqual({ baseCount: 10, indexedCount: 4 })
    expect((db._chains as ChainLog[]).some((chain) => chain.table === 'todos')).toBe(true)
    expect((db._chains as ChainLog[]).some((chain) => chain.table === 'entity_indexes')).toBe(true)
    expect(db._mutations).toEqual(expect.arrayContaining([
      { kind: 'insert', table: 'entity_index_coverage' },
    ]))
  })

  test('serves stale coverage snapshots and schedules refresh when optimization flag is enabled', async () => {
    process.env.QUERY_INDEX_COVERAGE_CACHE_MS = '1000'
    process.env.OPTIMIZE_INDEX_COVERAGE_STATS = 'true'
    const db = createFakeKysely({
      baseTable: 'todos',
      hasIndexAny: true,
      baseCount: 10,
      indexCount: 4,
      coverageRefreshedAt: new Date(Date.now() - 10_000),
    })
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(buildEm(db), { query: jest.fn() } as any, () => ({ emitEvent }))

    const snapshot = await (engine as any).getStoredCoverageSnapshot('example:todo', 't1', 'org1', false)
    await Promise.resolve()
    await Promise.resolve()

    expect(snapshot).toEqual({ baseCount: 10, indexedCount: 4 })
    expect((db._chains as ChainLog[]).some((chain) => chain.table === 'todos')).toBe(false)
    expect(db._mutations).toEqual([])
    expect(emitEvent).toHaveBeenCalledWith('query_index.coverage.refresh', {
      entityType: 'example:todo',
      tenantId: 't1',
      organizationId: 'org1',
      withDeleted: false,
      delayMs: 0,
    })
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

  test('decrypts selected base fields with organization fallback when rows omit scope columns', async () => {
    const db = createFakeKysely({
      baseTable: 'users',
      hasIndexAny: true,
      baseCount: 1,
      indexCount: 1,
      rows: {
        users: [{ id: 'user-1', name: 'encrypted-name', tenant_id: 't1' }],
      },
    })
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const decryptEntityPayload = jest.fn(async () => ({ name: 'Alice Owner' }))
    const engine = new HybridQueryEngine(
      em,
      fallback as any,
      () => ({ emitEvent }),
      undefined,
      () => ({ decryptEntityPayload }),
    )

    const result = await engine.query('auth:user', {
      fields: ['id', 'name'],
      organizationId: 'org1',
      tenantId: 't1',
      page: { page: 1, pageSize: 50 },
    })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(decryptEntityPayload).toHaveBeenCalledWith(
      'auth:user',
      expect.objectContaining({ id: 'user-1', name: 'encrypted-name' }),
      't1',
      'org1',
    )
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'user-1', name: 'Alice Owner' }),
    ])
  })

  test('sorts encrypted base fields after decryption before pagination', async () => {
    const db = createFakeKysely({
      baseTable: 'customer_entities',
      hasIndexAny: true,
      baseCount: 5,
      indexCount: 5,
      columns: [
        { table_name: 'customer_entities', column_name: 'id' },
        { table_name: 'customer_entities', column_name: 'tenant_id' },
        { table_name: 'customer_entities', column_name: 'organization_id' },
        { table_name: 'customer_entities', column_name: 'deleted_at' },
        { table_name: 'customer_entities', column_name: 'display_name' },
      ],
      rows: {
        customer_entities: [
          { id: '3', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-c' },
          { id: '1', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-a' },
          { id: '5', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-e' },
          { id: '2', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-b' },
          { id: '4', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-d' },
        ],
      },
    })
    const namesById: Record<string, string> = {
      '1': 'Alice',
      '2': 'Bob',
      '3': 'Charlie',
      '4': 'Dave',
      '5': 'Eve',
    }
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(
      em,
      fallback as any,
      () => ({ emitEvent }),
      undefined,
      () => ({
        isEnabled: () => true,
        getEncryptedFieldNames: async () => ['display_name'],
        decryptEntityPayload: async (_entityId, payload) => ({
          display_name: namesById[String(payload.id)],
        }),
      }),
    )

    const result = await engine.query('customers:customer_entity', {
      // `tenant_id` is requested for output but is not a sort field, so phase 1
      // (id + sort columns only) should select fewer columns than phase 2 (full row).
      fields: ['id', 'display_name', 'tenant_id'],
      organizationId: 'org1',
      tenantId: 't1',
      sort: [{ field: 'display_name', dir: SortDir.Asc }],
      page: { page: 2, pageSize: 2 },
    })

    expect(fallback.query).not.toHaveBeenCalled()
    expect(result.items.map((item: any) => item.display_name)).toEqual(['Charlie', 'Dave'])
    const customerEntityChains = db._chains.filter((chain: ChainLog) => chain.table === 'customer_entities')
    // count (optimized path), phase 1 (slim id+sort-column scan), phase 2 (full fetch).
    expect(customerEntityChains.length).toBe(3)
    const [phase1Chain, phase2Chain] = customerEntityChains.slice(-2)
    // Phase 1: no SQL order/limit — the full candidate set is fetched, decrypted,
    // and sorted in memory.
    expect(phase1Chain.orderBys).toEqual([])
    expect(phase1Chain.limit).toBeNull()
    expect(phase1Chain.selects.length).toBeLessThan(phase2Chain.selects.length)
    // Phase 2: filtered by `id in [...]`, no SQL order/limit needed since the id
    // list already bounds it to the page.
    expect(phase2Chain.orderBys).toEqual([])
    expect(phase2Chain.limit).toBeNull()
    expect(phase2Chain.offset).toBeNull()
    expect(phase2Chain.wheres.some((args: any[]) => args.includes('in'))).toBe(true)
  })

  test('paginates encrypted-sorted results correctly on page 1 and the tail page', async () => {
    const db = createFakeKysely({
      baseTable: 'customer_entities',
      hasIndexAny: true,
      baseCount: 5,
      indexCount: 5,
      columns: [
        { table_name: 'customer_entities', column_name: 'id' },
        { table_name: 'customer_entities', column_name: 'tenant_id' },
        { table_name: 'customer_entities', column_name: 'organization_id' },
        { table_name: 'customer_entities', column_name: 'deleted_at' },
        { table_name: 'customer_entities', column_name: 'display_name' },
      ],
      rows: {
        customer_entities: [
          { id: '3', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-c' },
          { id: '1', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-a' },
          { id: '5', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-e' },
          { id: '2', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-b' },
          { id: '4', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-d' },
        ],
      },
    })
    const namesById: Record<string, string> = {
      '1': 'Alice', '2': 'Bob', '3': 'Charlie', '4': 'Dave', '5': 'Eve',
    }
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(
      em,
      fallback as any,
      () => ({ emitEvent }),
      undefined,
      () => ({
        isEnabled: () => true,
        getEncryptedFieldNames: async () => ['display_name'],
        decryptEntityPayload: async (_entityId, payload) => ({
          display_name: namesById[String(payload.id)],
        }),
      }),
    )

    const page1 = await engine.query('customers:customer_entity', {
      fields: ['id', 'display_name'],
      organizationId: 'org1',
      tenantId: 't1',
      sort: [{ field: 'display_name', dir: SortDir.Asc }],
      page: { page: 1, pageSize: 2 },
    })
    expect(page1.items.map((item: any) => item.display_name)).toEqual(['Alice', 'Bob'])

    const page3 = await engine.query('customers:customer_entity', {
      fields: ['id', 'display_name'],
      organizationId: 'org1',
      tenantId: 't1',
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
      const db = createFakeKysely({
        baseTable: 'customer_entities',
        hasIndexAny: true,
        baseCount: 5,
        indexCount: 5,
        columns: [
          { table_name: 'customer_entities', column_name: 'id' },
          { table_name: 'customer_entities', column_name: 'tenant_id' },
          { table_name: 'customer_entities', column_name: 'organization_id' },
          { table_name: 'customer_entities', column_name: 'deleted_at' },
          { table_name: 'customer_entities', column_name: 'display_name' },
        ],
        rows: {
          customer_entities: [
            { id: '3', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-c' },
            { id: '1', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-a' },
            { id: '5', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-e' },
            { id: '2', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-b' },
            { id: '4', tenant_id: 't1', organization_id: 'org1', display_name: 'cipher-d' },
          ],
        },
      })
      const namesById: Record<string, string> = {
        '1': 'Alice', '2': 'Bob', '3': 'Charlie', '4': 'Dave', '5': 'Eve',
      }
      const em = buildEm(db)
      const fallback = { query: jest.fn() }
      const emitEvent = jest.fn().mockResolvedValue(undefined)
      const engine = new HybridQueryEngine(
        em,
        fallback as any,
        () => ({ emitEvent }),
        undefined,
        () => ({
          isEnabled: () => true,
          getEncryptedFieldNames: async () => ['display_name'],
          decryptEntityPayload: async (_entityId, payload) => ({
            display_name: namesById[String(payload.id)],
          }),
        }),
      )
      return { db, engine }
    }

    test('unset: no limit on the phase-1 scan, no warning', async () => {
      delete process.env.OM_ENCRYPTED_SORT_MAX_ROWS
      const { db, engine } = buildFixture()
      const result = await engine.query('customers:customer_entity', {
        fields: ['id', 'display_name'],
        organizationId: 'org1',
        tenantId: 't1',
        sort: [{ field: 'display_name', dir: SortDir.Asc }],
        page: { page: 1, pageSize: 2 },
      })
      expect(result.meta?.encryptedSortRowCapWarning).toBeUndefined()
      const [phase1Chain] = db._chains
        .filter((chain: ChainLog) => chain.table === 'customer_entities')
        .slice(-2)
      expect(phase1Chain.limit).toBeNull()
    })

    test('set but not exceeded: no warning, identical results to uncapped', async () => {
      process.env.OM_ENCRYPTED_SORT_MAX_ROWS = '10'
      const { engine } = buildFixture()
      const result = await engine.query('customers:customer_entity', {
        fields: ['id', 'display_name'],
        organizationId: 'org1',
        tenantId: 't1',
        sort: [{ field: 'display_name', dir: SortDir.Asc }],
        page: { page: 1, pageSize: 2 },
      })
      expect(result.meta?.encryptedSortRowCapWarning).toBeUndefined()
      expect(result.items.map((item: any) => item.display_name)).toEqual(['Alice', 'Bob'])
    })

    test('set and exceeded: caps + orders the phase-1 scan and attaches a warning', async () => {
      process.env.OM_ENCRYPTED_SORT_MAX_ROWS = '3'
      const { db, engine } = buildFixture()
      const result = await engine.query('customers:customer_entity', {
        fields: ['id', 'display_name'],
        organizationId: 'org1',
        tenantId: 't1',
        sort: [{ field: 'display_name', dir: SortDir.Asc }],
        page: { page: 1, pageSize: 2 },
      })
      expect(result.meta?.encryptedSortRowCapWarning).toEqual({
        entity: 'customers:customer_entity',
        sortFields: ['display_name'],
        maxRows: 3,
        totalMatched: 5,
      })
      const [phase1Chain] = db._chains
        .filter((chain: ChainLog) => chain.table === 'customer_entities')
        .slice(-2)
      expect(phase1Chain.limit).toBe(3)
      expect(phase1Chain.orderBys).toEqual([['b.id', 'asc']])
    })
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

describe('sort direction coercion (#2704)', () => {
  const INJECTED_DIR = "asc, CASE WHEN (SELECT secret FROM vault) LIKE '%a%' THEN pg_sleep(2) ELSE 0 END"

  const serializeOrderBys = (db: any): string => {
    const orderByArgs = (db._chains as ChainLog[]).flatMap((chain) => chain.orderBys).flat()
    expect(orderByArgs.length).toBeGreaterThan(0)
    return JSON.stringify(orderByArgs.map((arg: any) =>
      typeof arg?.toOperationNode === 'function' ? arg.toOperationNode() : arg,
    ))
  }

  test('coerceSortDirection only ever returns asc or desc', () => {
    expect(coerceSortDirection(SortDir.Asc)).toBe(SortDir.Asc)
    expect(coerceSortDirection(SortDir.Desc)).toBe(SortDir.Desc)
    expect(coerceSortDirection('DESC')).toBe(SortDir.Desc)
    expect(coerceSortDirection(undefined)).toBe(SortDir.Asc)
    expect(coerceSortDirection(null)).toBe(SortDir.Asc)
    expect(coerceSortDirection(INJECTED_DIR)).toBe(SortDir.Asc)
  })

  test('hybrid cf sort never inlines an attacker-controlled direction', async () => {
    const db = createFakeKysely({ baseTable: 'todos', hasIndexAny: true, baseCount: 5, indexCount: 5 })
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))

    await engine.query('example:todo', {
      fields: ['id', 'cf:priority'],
      includeCustomFields: true,
      organizationId: 'org1',
      tenantId: 't1',
      sort: [{ field: 'cf:priority', dir: INJECTED_DIR as SortDir }],
    })

    expect(fallback.query).not.toHaveBeenCalled()
    const serialized = serializeOrderBys(db)
    expect(serialized).not.toContain('pg_sleep')
    expect(serialized).not.toContain('vault')
  })

  test('custom entity doc sort never inlines an attacker-controlled direction', async () => {
    const db = createFakeKysely({
      baseTable: 'todos',
      hasIndexAny: false,
      baseCount: 0,
      indexCount: 0,
      rows: { custom_entities_storage: [] },
    })
    const em = buildEm(db)
    const fallback = { query: jest.fn() }
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent }))
    jest.spyOn(engine as any, 'isCustomEntity').mockResolvedValue(true)

    await engine.query('example:custom_thing', {
      fields: ['id', 'title'],
      organizationId: 'org1',
      tenantId: 't1',
      sort: [{ field: 'title', dir: INJECTED_DIR as SortDir }],
    })

    expect(fallback.query).not.toHaveBeenCalled()
    const serialized = serializeOrderBys(db)
    expect(serialized).not.toContain('pg_sleep')
    expect(serialized).not.toContain('vault')
  })
})

describe('HybridQueryEngine custom-entity classification (#2939)', () => {
  test('stray doc-storage rows must not reroute a table-backed ORM entity away from its base table', async () => {
    const db = createFakeKysely({
      baseTable: 'customer_deals',
      hasIndexAny: false,
      baseCount: 282,
      indexCount: 0,
      customFieldKeys: {},
      rows: { custom_entities_storage: [{ entity_id: 'stray-doc-record' }] },
    })
    const em = buildEmWithOrmMetadata(db, { CustomerDeal: 'customer_deals' })
    const fallback = { query: jest.fn() }
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent: jest.fn() }))

    await expect((engine as any).isCustomEntity('customers:customer_deal')).resolves.toBe(false)

    await engine.query('customers:customer_deal', {
      fields: ['id', 'title', 'pipeline_stage_id'],
      includeCustomFields: true,
      organizationIds: ['org1'],
      tenantId: 't1',
    })

    const chains = db._chains as ChainLog[]
    expect(chains.some((chain) => chain.table === 'customer_deals')).toBe(true)
  })

  test('module-declared custom entities without an ORM table keep doc-storage routing (read/write symmetry)', async () => {
    const db = createFakeKysely({
      baseTable: 'unused',
      hasIndexAny: false,
      baseCount: 0,
      indexCount: 0,
      customFieldKeys: {},
      rows: { custom_entities_storage: [{ entity_id: 'calendar-record' }] },
    })
    const em = buildEmWithOrmMetadata(db, {})
    const fallback = { query: jest.fn() }
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent: jest.fn() }))

    await expect((engine as any).isCustomEntity('example:calendar_entity')).resolves.toBe(true)
  })

  test('forceCustomEntityStorage routes a dual-declared id to doc storage (entities records surface)', async () => {
    const db = createFakeKysely({
      baseTable: 'todos',
      hasIndexAny: false,
      baseCount: 0,
      indexCount: 0,
      customFieldKeys: {},
      rows: { custom_entities_storage: [{ entity_id: 'todo-doc-record' }] },
    })
    const em = buildEmWithOrmMetadata(db, { Todo: 'todos' })
    const fallback = { query: jest.fn() }
    const engine = new HybridQueryEngine(em, fallback as any, () => ({ emitEvent: jest.fn() }))

    await engine.query('example:todo', {
      fields: ['id', 'title'],
      organizationIds: ['org1'],
      tenantId: 't1',
      forceCustomEntityStorage: true,
    })

    const chains = db._chains as ChainLog[]
    expect(chains.some((chain) => chain.table === 'custom_entities_storage' && chain.selects.length > 0)).toBe(true)
    expect(chains.some((chain) => chain.table === 'todos')).toBe(false)
  })
})
