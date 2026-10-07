import { HybridQueryEngine, clearBaseTableExistsCache, baseTableExistsCacheSize } from '../lib/engine'

function buildEngine(existingTables: Set<string>) {
  const tableProbeCalls: string[] = []
  const db = {
    selectFrom: (table: string) => ({
      select: () => ({
        where: (_column: string, _op: string, value: string) => ({
          executeTakeFirst: async () => {
            if (table !== 'information_schema.tables') return undefined
            tableProbeCalls.push(value)
            return existingTables.has(value) ? { one: 1 } : undefined
          },
        }),
      }),
    }),
  }
  const em = { getKysely: () => db }
  const engine = new HybridQueryEngine(em as never, {} as never)
  return { engine: engine as unknown as { tableExists: (table: string) => Promise<boolean> }, tableProbeCalls }
}

describe('module-scoped base-table existence cache (#5619)', () => {
  const originalTtl = process.env.OM_QUERY_INDEX_BASE_TABLE_EXISTS_CACHE_MS
  const originalMaxEntries = process.env.OM_QUERY_INDEX_BASE_TABLE_EXISTS_CACHE_MAX_ENTRIES

  beforeEach(() => {
    clearBaseTableExistsCache()
  })

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.OM_QUERY_INDEX_BASE_TABLE_EXISTS_CACHE_MS
    else process.env.OM_QUERY_INDEX_BASE_TABLE_EXISTS_CACHE_MS = originalTtl
    if (originalMaxEntries === undefined) delete process.env.OM_QUERY_INDEX_BASE_TABLE_EXISTS_CACHE_MAX_ENTRIES
    else process.env.OM_QUERY_INDEX_BASE_TABLE_EXISTS_CACHE_MAX_ENTRIES = originalMaxEntries
    jest.restoreAllMocks()
  })

  test('a positive answer is reused across two separately constructed engines', async () => {
    const { engine: engine1, tableProbeCalls: calls1 } = buildEngine(new Set(['customer_entities']))
    expect(await engine1.tableExists('customer_entities')).toBe(true)
    expect(calls1.length).toBe(1)

    const { engine: engine2, tableProbeCalls: calls2 } = buildEngine(new Set(['customer_entities']))
    expect(await engine2.tableExists('customer_entities')).toBe(true)
    expect(calls2.length).toBe(0)
  })

  test('a negative answer is not cached, so a table created after the first miss is picked up immediately', async () => {
    const { engine: missingEngine, tableProbeCalls: missingCalls } = buildEngine(new Set())
    expect(await missingEngine.tableExists('sales_orders')).toBe(false)
    expect(missingCalls.length).toBe(1)

    const { engine: stillMissingEngine, tableProbeCalls: stillMissingCalls } = buildEngine(new Set())
    expect(await stillMissingEngine.tableExists('sales_orders')).toBe(false)
    expect(stillMissingCalls.length).toBe(1)

    const { engine: migratedEngine, tableProbeCalls: migratedCalls } = buildEngine(new Set(['sales_orders']))
    expect(await migratedEngine.tableExists('sales_orders')).toBe(true)
    expect(migratedCalls.length).toBe(1)
  })

  test('a cached positive answer expires at the TTL and is re-probed afterwards', async () => {
    const now = 1_700_000_000_000
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now)

    const { engine: engine1, tableProbeCalls: calls1 } = buildEngine(new Set(['customer_entities']))
    expect(await engine1.tableExists('customer_entities')).toBe(true)
    expect(calls1.length).toBe(1)

    const { engine: engine2, tableProbeCalls: calls2 } = buildEngine(new Set(['customer_entities']))
    expect(await engine2.tableExists('customer_entities')).toBe(true)
    expect(calls2.length).toBe(0)

    nowSpy.mockReturnValue(now + 3_600_001)
    const { engine: engine3, tableProbeCalls: calls3 } = buildEngine(new Set(['customer_entities']))
    expect(await engine3.tableExists('customer_entities')).toBe(true)
    expect(calls3.length).toBe(1)
  })

  test('the cache is bounded under distinct-table pressure', async () => {
    process.env.OM_QUERY_INDEX_BASE_TABLE_EXISTS_CACHE_MAX_ENTRIES = '4'
    const tables = Array.from({ length: 20 }, (_v, index) => `table_${index}`)
    const { engine } = buildEngine(new Set(tables))

    for (const table of tables) {
      expect(await engine.tableExists(table)).toBe(true)
      expect(baseTableExistsCacheSize()).toBeLessThanOrEqual(4)
    }
  })

  test('OM_QUERY_INDEX_BASE_TABLE_EXISTS_CACHE_MS=0 disables the memo and probes per call again', async () => {
    process.env.OM_QUERY_INDEX_BASE_TABLE_EXISTS_CACHE_MS = '0'

    const { engine: engine1, tableProbeCalls: calls1 } = buildEngine(new Set(['customer_entities']))
    expect(await engine1.tableExists('customer_entities')).toBe(true)
    expect(calls1.length).toBe(1)
    expect(baseTableExistsCacheSize()).toBe(0)

    const { engine: engine2, tableProbeCalls: calls2 } = buildEngine(new Set(['customer_entities']))
    expect(await engine2.tableExists('customer_entities')).toBe(true)
    expect(calls2.length).toBe(1)
  })
})
