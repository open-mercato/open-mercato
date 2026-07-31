import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DefaultDataEngine } from '../engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '../../crud/types'

// The bulk-import deferral (`suppress`) must gate the two per-record side effects `emitOrmEntityEvent`
// fans out — the `<module>.<entity>.<action>` domain event and the inline `query_index.upsert_one`
// reindex — while leaving normal (unsuppressed) writes untouched. It is threaded as a call parameter,
// never stored on the engine, so it must not leak between successive calls on the same instance.

const EVENTS: CrudEventsConfig<unknown> = { module: 'sales', entity: 'order', persistent: false }
const INDEXER: CrudIndexerConfig<unknown> = { entityType: 'sales:sales_order' }
const IDENTIFIERS = { id: 'rec-1', organizationId: 'org-1', tenantId: 'tenant-1' }

function buildEngine() {
  const emitEvent = jest.fn().mockResolvedValue(undefined)
  const container = {
    resolve: (token: string) => {
      if (token === 'eventBus') return { emitEvent }
      throw new Error(`unexpected resolve(${token})`)
    },
  } as unknown as AwilixContainer
  const engine = new DefaultDataEngine({} as EntityManager, container)
  const emittedNames = () => emitEvent.mock.calls.map((c) => c[0] as string)
  return { engine, emitEvent, emittedNames }
}

describe('DefaultDataEngine bulk-import suppression', () => {
  // The test events are intentionally not registered in the event registry; silence the
  // one-time "undeclared event" warning so it doesn't clutter the suite output.
  let warnSpy: jest.SpyInstance
  beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined) })
  afterAll(() => { warnSpy.mockRestore() })

  it('emits both the domain event and the reindex when unsuppressed', async () => {
    const { engine, emittedNames } = buildEngine()
    await engine.emitOrmEntityEvent({ action: 'created', entity: {}, events: EVENTS, indexer: INDEXER, identifiers: IDENTIFIERS })
    expect(emittedNames()).toEqual(expect.arrayContaining(['sales.order.created', 'query_index.upsert_one']))
  })

  it('skips the domain event but keeps the reindex with skipEvents', async () => {
    const { engine, emittedNames } = buildEngine()
    await engine.emitOrmEntityEvent({ action: 'created', entity: {}, events: EVENTS, indexer: INDEXER, identifiers: IDENTIFIERS, suppress: { skipEvents: true } })
    const names = emittedNames()
    expect(names).not.toContain('sales.order.created')
    expect(names).toContain('query_index.upsert_one')
  })

  it('skips the reindex but keeps the domain event with skipReindex', async () => {
    const { engine, emittedNames } = buildEngine()
    await engine.emitOrmEntityEvent({ action: 'created', entity: {}, events: EVENTS, indexer: INDEXER, identifiers: IDENTIFIERS, suppress: { skipReindex: true } })
    const names = emittedNames()
    expect(names).toContain('sales.order.created')
    expect(names).not.toContain('query_index.upsert_one')
  })

  it('emits nothing when both are suppressed', async () => {
    const { engine, emitEvent } = buildEngine()
    await engine.emitOrmEntityEvent({ action: 'created', entity: {}, events: EVENTS, indexer: INDEXER, identifiers: IDENTIFIERS, suppress: { skipEvents: true, skipReindex: true } })
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('flushOrmEntityChanges threads suppress to every queued entry, and does not leak to later flushes', async () => {
    const { engine, emitEvent, emittedNames } = buildEngine()
    // Queue one change, flush it suppressed → nothing emitted.
    engine.markOrmEntityChange({ action: 'created', entity: {}, events: EVENTS, indexer: INDEXER, identifiers: IDENTIFIERS })
    await engine.flushOrmEntityChanges({ skipEvents: true, skipReindex: true })
    expect(emitEvent).not.toHaveBeenCalled()

    // A subsequent normal flush on the SAME engine must be unaffected (no stored suppression).
    engine.markOrmEntityChange({ action: 'created', entity: {}, events: EVENTS, indexer: INDEXER, identifiers: { ...IDENTIFIERS, id: 'rec-2' } })
    await engine.flushOrmEntityChanges()
    expect(emittedNames()).toEqual(expect.arrayContaining(['sales.order.created', 'query_index.upsert_one']))
  })
})
