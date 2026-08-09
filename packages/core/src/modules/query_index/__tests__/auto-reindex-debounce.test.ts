import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { QueryOptions } from '@open-mercato/shared/lib/query/types'
import { HybridQueryEngine } from '../lib/engine'

type AutoReindexHarness = {
  scheduleAutoReindex: (entity: string, options: QueryOptions) => void
}

const AUTO_REINDEX_SCHEDULED_AT_KEY = Symbol.for('@open-mercato/query-index/auto-reindex-scheduled-at')

function buildEngine(emitEvent: jest.Mock): AutoReindexHarness {
  const engine = new HybridQueryEngine(
    {} as EntityManager,
    {} as BasicQueryEngine,
    () => ({ emitEvent }),
  )
  return engine as unknown as AutoReindexHarness
}

function buildIsolatedEngine(emitEvent: jest.Mock): AutoReindexHarness {
  let engine: AutoReindexHarness | null = null
  jest.isolateModules(() => {
    const { HybridQueryEngine: IsolatedHybridQueryEngine } = jest.requireActual<typeof import('../lib/engine')>('../lib/engine')
    engine = new IsolatedHybridQueryEngine(
      {} as EntityManager,
      {} as BasicQueryEngine,
      () => ({ emitEvent }),
    ) as unknown as AutoReindexHarness
  })
  if (!engine) throw new Error('[internal] Failed to construct isolated query engine')
  return engine
}

async function flushScheduledEvent(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('scheduleAutoReindex debounce', () => {
  const originalDebounce = process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS
  const originalEnabled = process.env.SCHEDULE_AUTO_REINDEX

  beforeEach(() => {
    delete (globalThis as Record<symbol, unknown>)[AUTO_REINDEX_SCHEDULED_AT_KEY]
    process.env.SCHEDULE_AUTO_REINDEX = 'true'
    process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS = '30000'
  })

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[AUTO_REINDEX_SCHEDULED_AT_KEY]
    jest.restoreAllMocks()
    if (originalDebounce === undefined) delete process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS
    else process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS = originalDebounce
    if (originalEnabled === undefined) delete process.env.SCHEDULE_AUTO_REINDEX
    else process.env.SCHEDULE_AUTO_REINDEX = originalEnabled
  })

  test('collapses repeated schedules for one scope', async () => {
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = buildEngine(emitEvent)
    const options = { tenantId: 'debounce-burst', organizationId: 'organization-1' }

    engine.scheduleAutoReindex('messages:message', options)
    engine.scheduleAutoReindex('messages:message', options)
    engine.scheduleAutoReindex('messages:message', options)
    await flushScheduledEvent()

    expect(emitEvent).toHaveBeenCalledTimes(1)
  })

  test('shares debounce state across engine instances', async () => {
    const firstEmit = jest.fn().mockResolvedValue(undefined)
    const secondEmit = jest.fn().mockResolvedValue(undefined)
    const options = { tenantId: 'debounce-engines', organizationId: 'organization-1' }

    buildEngine(firstEmit).scheduleAutoReindex('messages:message', options)
    buildEngine(secondEmit).scheduleAutoReindex('messages:message', options)
    await flushScheduledEvent()

    expect(firstEmit).toHaveBeenCalledTimes(1)
    expect(secondEmit).not.toHaveBeenCalled()
  })

  test('shares debounce state across duplicated module instances', async () => {
    const firstEmit = jest.fn().mockResolvedValue(undefined)
    const secondEmit = jest.fn().mockResolvedValue(undefined)
    const options = { tenantId: 'debounce-modules', organizationId: 'organization-1' }

    buildIsolatedEngine(firstEmit).scheduleAutoReindex('messages:message', options)
    buildIsolatedEngine(secondEmit).scheduleAutoReindex('messages:message', options)
    await flushScheduledEvent()

    expect(firstEmit).toHaveBeenCalledTimes(1)
    expect(secondEmit).not.toHaveBeenCalled()
  })

  test('keeps distinct scopes independent', async () => {
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = buildEngine(emitEvent)

    engine.scheduleAutoReindex('messages:message', { tenantId: 'debounce-scope-a', organizationId: 'organization-1' })
    engine.scheduleAutoReindex('messages:message', { tenantId: 'debounce-scope-b', organizationId: 'organization-1' })
    await flushScheduledEvent()

    expect(emitEvent).toHaveBeenCalledTimes(2)
  })

  test('allows the same scope to schedule after the debounce window', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000)
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const engine = buildEngine(emitEvent)
    const options = { tenantId: 'debounce-expiry', organizationId: 'organization-1' }

    engine.scheduleAutoReindex('messages:message', options)
    now.mockReturnValue(31_001)
    engine.scheduleAutoReindex('messages:message', options)
    await flushScheduledEvent()

    expect(emitEvent).toHaveBeenCalledTimes(2)
  })
})
