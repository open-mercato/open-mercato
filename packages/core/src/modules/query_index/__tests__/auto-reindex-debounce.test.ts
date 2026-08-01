import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { QueryOptions } from '@open-mercato/shared/lib/query/types'
import { HybridQueryEngine } from '../lib/engine'

type AutoReindexHarness = {
  scheduleAutoReindex: (entity: string, options: QueryOptions) => void
}

function buildEngine(emitEvent: jest.Mock): AutoReindexHarness {
  const engine = new HybridQueryEngine(
    {} as EntityManager,
    {} as BasicQueryEngine,
    () => ({ emitEvent }),
  )
  return engine as unknown as AutoReindexHarness
}

async function flushScheduledEvent(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('scheduleAutoReindex debounce', () => {
  const originalDebounce = process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS
  const originalEnabled = process.env.SCHEDULE_AUTO_REINDEX

  beforeEach(() => {
    process.env.SCHEDULE_AUTO_REINDEX = 'true'
    process.env.OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS = '30000'
  })

  afterEach(() => {
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
