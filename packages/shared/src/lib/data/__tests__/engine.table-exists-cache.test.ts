import { DefaultDataEngine, clearDataEngineTableExistsCache } from '../engine'
import { registerEntityIds } from '../../encryption/entityIds'

const ENTITY_ID = 'example:todo'
const RECORD_ID = '11111111-1111-4111-8111-111111111111'

function buildDb(options: { tableExists?: boolean } = {}) {
  const tableProbeCalls: string[] = []
  const tableExists = options.tableExists !== false

  const chain: any = {
    select: () => chain,
    where: (column: string, _op: string, value: unknown) => {
      if (column === 'table_name') tableProbeCalls.push(String(value))
      return chain
    },
    values: () => chain,
    set: () => chain,
    onConflict: (callback: (builder: { columns: (_columns: string[]) => { doUpdateSet: (_values: unknown) => unknown } }) => unknown) => {
      callback({ columns: () => ({ doUpdateSet: () => ({}) }) })
      return chain
    },
    executeTakeFirst: async () => (tableExists ? { present: 1 } : undefined),
    execute: async () => [],
  }

  return {
    tableProbeCalls,
    db: {
      selectFrom: () => chain,
      insertInto: () => chain,
      updateTable: () => chain,
      deleteFrom: () => chain,
    },
  }
}

function buildEngine(options: { tableExists?: boolean } = {}) {
  const { db, tableProbeCalls } = buildDb(options)
  const em = {
    getKysely: () => db,
    getMetadata: () => ({ find: () => undefined, getAll: () => [] }),
    find: async () => [],
    persist: () => undefined,
    flush: async () => undefined,
  }
  return { engine: new DefaultDataEngine(em as never, {} as never), tableProbeCalls }
}

describe('module-scoped custom_entities_storage existence cache (#5619)', () => {
  const originalTtl = process.env.OM_DATA_ENGINE_TABLE_EXISTS_CACHE_MS

  beforeEach(() => {
    registerEntityIds({ example: { todo: ENTITY_ID } })
    clearDataEngineTableExistsCache()
  })

  afterEach(() => {
    registerEntityIds({})
    if (originalTtl === undefined) delete process.env.OM_DATA_ENGINE_TABLE_EXISTS_CACHE_MS
    else process.env.OM_DATA_ENGINE_TABLE_EXISTS_CACHE_MS = originalTtl
    jest.restoreAllMocks()
  })

  test('the table-existence answer is reused across two separately constructed engines', async () => {
    // `createRequestContainer()` builds a fresh `DefaultDataEngine` per HTTP request. The cache
    // must live on the module, not the instance, so a later "request" (a second engine here)
    // reuses the first request's answer instead of re-probing `information_schema.tables`.
    const { engine: engine1, tableProbeCalls: calls1 } = buildEngine()
    await engine1.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: null, values: {} })
    expect(calls1.filter((name) => name === 'custom_entities_storage').length).toBe(1)

    const { engine: engine2, tableProbeCalls: calls2 } = buildEngine()
    await engine2.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: null, values: {} })
    expect(calls2.filter((name) => name === 'custom_entities_storage').length).toBe(0)
  })

  test('a negative answer expires at the TTL and is re-probed rather than cached forever', async () => {
    const now = 1_700_000_000_000
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now)

    const { engine: missingEngine, tableProbeCalls: missingCalls } = buildEngine({ tableExists: false })
    await expect(
      missingEngine.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: null, values: {} }),
    ).rejects.toThrow('custom_entities_storage table is missing')
    expect(missingCalls.length).toBe(1)

    // A negative answer is never cached, so an immediate retry probes again rather than
    // inheriting the earlier failure for the TTL window.
    const { engine: stillMissingEngine, tableProbeCalls: stillMissingCalls } = buildEngine({ tableExists: false })
    await expect(
      stillMissingEngine.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: null, values: {} }),
    ).rejects.toThrow('custom_entities_storage table is missing')
    expect(stillMissingCalls.length).toBe(1)

    nowSpy.mockReturnValue(now)
    const { engine: migratedEngine, tableProbeCalls: migratedCalls } = buildEngine({ tableExists: true })
    await migratedEngine.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: null, values: {} })
    expect(migratedCalls.length).toBe(1)

    const { engine: cachedEngine, tableProbeCalls: cachedCalls } = buildEngine({ tableExists: true })
    await cachedEngine.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: null, values: {} })
    expect(cachedCalls.length).toBe(0)

    nowSpy.mockReturnValue(now + 3_600_001)
    const { engine: expiredEngine, tableProbeCalls: expiredCalls } = buildEngine({ tableExists: true })
    await expiredEngine.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: null, values: {} })
    expect(expiredCalls.length).toBe(1)
  })

  test('OM_DATA_ENGINE_TABLE_EXISTS_CACHE_MS=0 disables the memo and probes per call again', async () => {
    process.env.OM_DATA_ENGINE_TABLE_EXISTS_CACHE_MS = '0'

    const { engine: engine1, tableProbeCalls: calls1 } = buildEngine({ tableExists: true })
    await engine1.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: null, values: {} })
    expect(calls1.length).toBe(1)

    const { engine: engine2, tableProbeCalls: calls2 } = buildEngine({ tableExists: true })
    await engine2.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: null, values: {} })
    expect(calls2.length).toBe(1)
  })
})
