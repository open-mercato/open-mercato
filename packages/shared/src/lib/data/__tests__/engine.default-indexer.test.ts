import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DefaultDataEngine } from '../engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '../../crud/types'

// A command-backed CRUD route (`makeCrudRoute` + `actions.*`) cannot mark its own side effect:
// the handler owns the mark and the command bus owns the flush. The route therefore hands its
// declared `indexer:` to the engine for the duration of the command, and the engine applies it
// to marks the handler makes without one — otherwise the declaration reaches no code at all and
// the projection is never written (#5741). The entity-class gate is what keeps a handler's
// sibling-entity marks from being indexed under the route's entityType.

class RouteEntity {
  constructor(public id: string) {}
}

class SiblingEntity {
  constructor(public id: string) {}
}

const EVENTS: CrudEventsConfig<unknown> = { module: 'customers', entity: 'tag', persistent: false }
const ROUTE_INDEXER: CrudIndexerConfig<unknown> = { entityType: 'customers:customer_tag' }
const HANDLER_INDEXER: CrudIndexerConfig<unknown> = { entityType: 'customers:handler_owned' }
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
  const indexPayloads = (eventName: string) =>
    emitEvent.mock.calls.filter(([name]) => name === eventName).map(([, payload]) => payload as Record<string, unknown>)
  return { engine, emitEvent, indexPayloads }
}

describe('DefaultDataEngine route-declared indexer default', () => {
  let warnSpy: jest.SpyInstance
  beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined) })
  afterAll(() => { warnSpy.mockRestore() })

  it('indexes an events-only mark under the route-declared entityType', async () => {
    const { engine, indexPayloads } = buildEngine()
    engine.setDefaultIndexerConfig({ indexer: ROUTE_INDEXER, entityClass: RouteEntity })

    // What every command handler on the two affected core routes does: mark `events:` only.
    engine.markOrmEntityChange({ action: 'created', entity: new RouteEntity('rec-1'), events: EVENTS, identifiers: IDENTIFIERS })
    await engine.flushOrmEntityChanges()

    const upserts = indexPayloads('query_index.upsert_one')
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({ entityType: 'customers:customer_tag', recordId: 'rec-1', crudAction: 'created' })
    expect(engine.hasIndexedDefaultEntityClass()).toBe(true)
  })

  it('emits the delete projection for an events-only delete mark', async () => {
    const { engine, indexPayloads } = buildEngine()
    engine.setDefaultIndexerConfig({ indexer: ROUTE_INDEXER, entityClass: RouteEntity })

    engine.markOrmEntityChange({ action: 'deleted', entity: new RouteEntity('rec-1'), events: EVENTS, identifiers: IDENTIFIERS })
    await engine.flushOrmEntityChanges()

    expect(indexPayloads('query_index.delete_one')).toHaveLength(1)
    expect(indexPayloads('query_index.upsert_one')).toHaveLength(0)
  })

  it('leaves a handler-supplied indexer untouched — explicit wins over the default', async () => {
    const { engine, indexPayloads } = buildEngine()
    engine.setDefaultIndexerConfig({ indexer: ROUTE_INDEXER, entityClass: RouteEntity })

    engine.markOrmEntityChange({
      action: 'updated',
      entity: new RouteEntity('rec-1'),
      events: EVENTS,
      indexer: HANDLER_INDEXER,
      identifiers: IDENTIFIERS,
    })
    await engine.flushOrmEntityChanges()

    const upserts = indexPayloads('query_index.upsert_one')
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({ entityType: 'customers:handler_owned' })
  })

  it('does not apply the default to a mark for a different entity class', async () => {
    const { engine, emitEvent } = buildEngine()
    engine.setDefaultIndexerConfig({ indexer: ROUTE_INDEXER, entityClass: RouteEntity })

    // A tag command also marks its tag *assignments*; indexing those as `customer_tag` would
    // write a projection row for the wrong record.
    engine.markOrmEntityChange({ action: 'updated', entity: new SiblingEntity('assignment-1'), identifiers: { ...IDENTIFIERS, id: 'assignment-1' } })
    await engine.flushOrmEntityChanges()

    expect(emitEvent.mock.calls.map(([name]) => name)).not.toContain('query_index.upsert_one')
    expect(engine.hasIndexedDefaultEntityClass()).toBe(false)
  })

  it('reports an undischarged declaration when the handler marks nothing at all', async () => {
    const { engine, emitEvent } = buildEngine()
    engine.setDefaultIndexerConfig({ indexer: ROUTE_INDEXER, entityClass: RouteEntity })

    await engine.flushOrmEntityChanges()

    expect(emitEvent).not.toHaveBeenCalled()
    expect(engine.hasIndexedDefaultEntityClass()).toBe(false)
  })

  it('stops applying the declaration once it is cleared', async () => {
    const { engine, emitEvent } = buildEngine()
    engine.setDefaultIndexerConfig({ indexer: ROUTE_INDEXER, entityClass: RouteEntity })
    engine.setDefaultIndexerConfig(null)

    engine.markOrmEntityChange({ action: 'created', entity: new RouteEntity('rec-1'), events: EVENTS, identifiers: IDENTIFIERS })
    await engine.flushOrmEntityChanges()

    expect(emitEvent.mock.calls.map(([name]) => name)).not.toContain('query_index.upsert_one')
    expect(engine.hasIndexedDefaultEntityClass()).toBe(false)
  })

  it('honours a bulk-import skipReindex suppression over the declaration', async () => {
    const { engine, emitEvent } = buildEngine()
    engine.setDefaultIndexerConfig({ indexer: ROUTE_INDEXER, entityClass: RouteEntity })

    engine.markOrmEntityChange({ action: 'created', entity: new RouteEntity('rec-1'), events: EVENTS, identifiers: IDENTIFIERS })
    await engine.flushOrmEntityChanges({ skipReindex: true })

    expect(emitEvent.mock.calls.map(([name]) => name)).not.toContain('query_index.upsert_one')
    expect(engine.hasIndexedDefaultEntityClass()).toBe(false)
  })
})
