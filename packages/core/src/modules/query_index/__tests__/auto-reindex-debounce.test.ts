import { HybridQueryEngine } from '../lib/engine'

// #4681: a burst of queries against an entity with a coverage gap must schedule
// a single reindex per debounce window, not one per query (the stampede).
describe('scheduleAutoReindex debounce', () => {
  const originalDebounce = process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS
  const originalEnabled = process.env.SCHEDULE_AUTO_REINDEX

  afterEach(() => {
    if (originalDebounce === undefined) delete process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS
    else process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS = originalDebounce
    if (originalEnabled === undefined) delete process.env.SCHEDULE_AUTO_REINDEX
    else process.env.SCHEDULE_AUTO_REINDEX = originalEnabled
  })

  const buildEngine = (emitEvent: jest.Mock) => {
    const bus = { emitEvent }
    return new HybridQueryEngine({} as any, {} as any, () => bus)
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve))

  it('collapses a burst of schedules for the same scope into one emit', async () => {
    process.env.SCHEDULE_AUTO_REINDEX = 'true'
    process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS = '30000'
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = buildEngine(emitEvent) as any

    const opts = { tenantId: 't1', organizationId: 'o1' }
    engine.scheduleAutoReindex('messages:message', opts)
    engine.scheduleAutoReindex('messages:message', opts)
    engine.scheduleAutoReindex('messages:message', opts)
    await flush()

    expect(emitEvent).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledWith(
      'query_index.reindex',
      expect.objectContaining({ entityType: 'messages:message', tenantId: 't1', organizationId: 'o1' }),
      expect.anything(),
    )
  })

  it('does not debounce a different scope', async () => {
    process.env.SCHEDULE_AUTO_REINDEX = 'true'
    process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS = '30000'
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = buildEngine(emitEvent) as any

    engine.scheduleAutoReindex('messages:message', { tenantId: 't1', organizationId: 'o1' })
    engine.scheduleAutoReindex('messages:message', { tenantId: 't2', organizationId: 'o1' })
    await flush()

    expect(emitEvent).toHaveBeenCalledTimes(2)
  })

  it('schedules every time when debounce is disabled', async () => {
    process.env.SCHEDULE_AUTO_REINDEX = 'true'
    process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS = '0'
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = buildEngine(emitEvent) as any

    const opts = { tenantId: 't1', organizationId: 'o1' }
    engine.scheduleAutoReindex('messages:message', opts)
    engine.scheduleAutoReindex('messages:message', opts)
    await flush()

    expect(emitEvent).toHaveBeenCalledTimes(2)
  })
})
