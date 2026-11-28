import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DefaultDataEngine } from '../engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '../../crud/types'

const IDENTIFIERS = { id: 'shared-id', organizationId: 'org-1', tenantId: 'tenant-1' }
const ACTIVITY_EVENTS: CrudEventsConfig<unknown> = { module: 'customers', entity: 'activity', persistent: false }
const INTERACTION_EVENTS: CrudEventsConfig<unknown> = { module: 'customers', entity: 'interaction', persistent: false }
const ACTIVITY_INDEXER: CrudIndexerConfig<unknown> = { entityType: 'customers:customer_activity' }
const INTERACTION_INDEXER: CrudIndexerConfig<unknown> = { entityType: 'customers:customer_interaction' }

class RouteEntity {
  constructor(public id: string) {}
}

function buildEngine() {
  const emitEvent = jest.fn().mockResolvedValue(undefined)
  const container = {
    resolve: (token: string) => {
      if (token === 'eventBus') return { emitEvent }
      throw new Error(`unexpected resolve(${token})`)
    },
  } as unknown as AwilixContainer
  const engine = new DefaultDataEngine({} as EntityManager, container)
  const eventNames = () => emitEvent.mock.calls.map(([name]) => name as string)
  const payloadsOf = (eventName: string) =>
    emitEvent.mock.calls.filter(([name]) => name === eventName).map(([, payload]) => payload as Record<string, unknown>)
  return { engine, eventNames, payloadsOf }
}

describe('DefaultDataEngine side-effect buffering identity', () => {
  let warnSpy: jest.SpyInstance
  beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined) })
  afterAll(() => { warnSpy.mockRestore() })

  it('still collapses duplicate marks of the same entity into one event and one upsert', async () => {
    const { engine, eventNames, payloadsOf } = buildEngine()

    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id', v: 1 }, identifiers: IDENTIFIERS, events: ACTIVITY_EVENTS, indexer: ACTIVITY_INDEXER })
    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id', v: 2 }, identifiers: IDENTIFIERS, events: ACTIVITY_EVENTS, indexer: ACTIVITY_INDEXER })
    await engine.flushOrmEntityChanges()

    expect(eventNames().filter((name) => name === 'customers.activity.updated')).toHaveLength(1)
    expect(payloadsOf('query_index.upsert_one')).toHaveLength(1)
  })

  it('still merges an events-only mark into an earlier indexer-only mark of the same record', async () => {
    const { engine, eventNames, payloadsOf } = buildEngine()

    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id' }, identifiers: IDENTIFIERS, indexer: ACTIVITY_INDEXER })
    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id' }, identifiers: IDENTIFIERS, events: ACTIVITY_EVENTS })
    await engine.flushOrmEntityChanges()

    expect(eventNames().filter((name) => name === 'customers.activity.updated')).toHaveLength(1)
    expect(payloadsOf('query_index.upsert_one')).toHaveLength(1)
  })

  it('keeps a route-default indexer mark merged with an explicit-indexer mark of the same record', async () => {
    const { engine, payloadsOf } = buildEngine()
    engine.setDefaultIndexerConfig({ indexer: INTERACTION_INDEXER, entityClass: RouteEntity })

    engine.markOrmEntityChange({ action: 'updated', entity: new RouteEntity('shared-id'), identifiers: IDENTIFIERS, events: ACTIVITY_EVENTS, indexer: ACTIVITY_INDEXER })
    engine.markOrmEntityChange({ action: 'updated', entity: new RouteEntity('shared-id'), identifiers: IDENTIFIERS, events: ACTIVITY_EVENTS })
    await engine.flushOrmEntityChanges()

    const upserts = payloadsOf('query_index.upsert_one')
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({ entityType: 'customers:customer_activity' })
  })

  it('emits both events and both upserts when two entity types share a record id', async () => {
    const { engine, eventNames, payloadsOf } = buildEngine()

    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id' }, identifiers: IDENTIFIERS, events: ACTIVITY_EVENTS, indexer: ACTIVITY_INDEXER })
    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id' }, identifiers: IDENTIFIERS, events: INTERACTION_EVENTS, indexer: INTERACTION_INDEXER })
    await engine.flushOrmEntityChanges()

    expect(eventNames()).toEqual(expect.arrayContaining(['customers.activity.updated', 'customers.interaction.updated']))
    expect(payloadsOf('query_index.upsert_one').map((payload) => payload.entityType).sort()).toEqual([
      'customers:customer_activity',
      'customers:customer_interaction',
    ])
  })

  it('routes later marks of each entity type to their own slot', async () => {
    const { engine, eventNames, payloadsOf } = buildEngine()

    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id' }, identifiers: IDENTIFIERS, events: ACTIVITY_EVENTS, indexer: ACTIVITY_INDEXER })
    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id' }, identifiers: IDENTIFIERS, events: INTERACTION_EVENTS, indexer: INTERACTION_INDEXER })
    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id' }, identifiers: IDENTIFIERS, events: INTERACTION_EVENTS, indexer: INTERACTION_INDEXER })
    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id' }, identifiers: IDENTIFIERS, events: ACTIVITY_EVENTS, indexer: ACTIVITY_INDEXER })
    await engine.flushOrmEntityChanges()

    expect(eventNames().filter((name) => name === 'customers.activity.updated')).toHaveLength(1)
    expect(eventNames().filter((name) => name === 'customers.interaction.updated')).toHaveLength(1)
    expect(payloadsOf('query_index.upsert_one')).toHaveLength(2)
  })

  it('separates indexer-only marks whose entity types differ', async () => {
    const { engine, payloadsOf } = buildEngine()

    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id' }, identifiers: IDENTIFIERS, indexer: ACTIVITY_INDEXER })
    engine.markOrmEntityChange({ action: 'updated', entity: { id: 'shared-id' }, identifiers: IDENTIFIERS, indexer: INTERACTION_INDEXER })
    await engine.flushOrmEntityChanges()

    expect(payloadsOf('query_index.upsert_one').map((payload) => payload.entityType).sort()).toEqual([
      'customers:customer_activity',
      'customers:customer_interaction',
    ])
  })
})
