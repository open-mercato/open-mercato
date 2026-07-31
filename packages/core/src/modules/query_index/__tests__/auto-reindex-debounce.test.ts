import { HybridQueryEngine } from '../lib/engine'

// #4681: a burst of queries against an entity with a coverage gap must schedule
// a single reindex per debounce window, not one per query (the stampede).
//
// The debounce state is module-level (process-global) on purpose, so each test
// uses a distinct tenant scope to avoid cross-test key collisions rather than
// resetting shared state.
describe('scheduleAutoReindex debounce', () => {
  const originalDebounce = process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS
  const originalEnabled = process.env.SCHEDULE_AUTO_REINDEX

  beforeEach(() => {
    process.env.SCHEDULE_AUTO_REINDEX = 'true'
    process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS = '30000'
  })

  afterEach(() => {
    if (originalDebounce === undefined) delete process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS
    else process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS = originalDebounce
    if (originalEnabled === undefined) delete process.env.SCHEDULE_AUTO_REINDEX
    else process.env.SCHEDULE_AUTO_REINDEX = originalEnabled
  })

  const buildEngine = (emitEvent: jest.Mock) => {
    const bus = { emitEvent }
    return new HybridQueryEngine({} as any, {} as any, () => bus) as any
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve))

  it('collapses a burst of schedules for the same scope into one emit', async () => {
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = buildEngine(emitEvent)

    const opts = { tenantId: 'collapse-t', organizationId: 'o1' }
    engine.scheduleAutoReindex('messages:message', opts)
    engine.scheduleAutoReindex('messages:message', opts)
    engine.scheduleAutoReindex('messages:message', opts)
    await flush()

    expect(emitEvent).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledWith(
      'query_index.reindex',
      expect.objectContaining({ entityType: 'messages:message', tenantId: 'collapse-t', organizationId: 'o1' }),
      expect.anything(),
    )
  })

  it('debounces across two independently constructed engines (per-request containers)', async () => {
    const emitA = jest.fn().mockResolvedValue(undefined)
    const emitB = jest.fn().mockResolvedValue(undefined)
    const engineA = buildEngine(emitA)
    const engineB = buildEngine(emitB)

    const opts = { tenantId: 'twoinst-t', organizationId: 'o1' }
    engineA.scheduleAutoReindex('messages:message', opts)
    engineB.scheduleAutoReindex('messages:message', opts)
    await flush()

    // Only the first engine's schedule emits; the second is within the window.
    expect(emitA).toHaveBeenCalledTimes(1)
    expect(emitB).toHaveBeenCalledTimes(0)
  })

  it('does not debounce a different scope', async () => {
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = buildEngine(emitEvent)

    engine.scheduleAutoReindex('messages:message', { tenantId: 'scope-a', organizationId: 'o1' })
    engine.scheduleAutoReindex('messages:message', { tenantId: 'scope-b', organizationId: 'o1' })
    await flush()

    expect(emitEvent).toHaveBeenCalledTimes(2)
  })

  it('schedules every time when debounce is disabled', async () => {
    process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS = '0'
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = buildEngine(emitEvent)

    const opts = { tenantId: 'disabled-t', organizationId: 'o1' }
    engine.scheduleAutoReindex('messages:message', opts)
    engine.scheduleAutoReindex('messages:message', opts)
    await flush()

    expect(emitEvent).toHaveBeenCalledTimes(2)
  })
})
