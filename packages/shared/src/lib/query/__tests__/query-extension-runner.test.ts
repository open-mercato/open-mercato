import { registerSyncSubscribers } from '../../crud/sync-subscriber-store'
import { registerResponseEnrichers } from '../../crud/enricher-registry'
import type { ResponseEnricher } from '../../crud/response-enricher'
import type { SyncSubscriberEntry } from '../../crud/sync-subscriber-store'
import type { QueryResult } from '../types'
import {
  entityIdToEventEntity,
  collectQuerySubscribers,
  runBeforeQueryEvent,
  runAfterQueryEvent,
  reapplyScopeGuards,
  applyQueryLevelEnrichers,
  runBeforeQueryPipeline,
  runAfterQueryPipeline,
} from '../query-extension-runner'
import type { SyncQueryEventPayload } from '../sync-query-event-types'

const ctx = { resolve: jest.fn() }

function makeQueryPayload(overrides?: Partial<SyncQueryEventPayload>): SyncQueryEventPayload {
  return {
    eventId: 'customers.person.querying',
    entity: 'customers.person',
    timing: 'before',
    engine: 'basic',
    query: { tenantId: 'tenant-1', organizationId: 'org-1' },
    userId: 'user-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    em: {} as never,
    ...overrides,
  }
}

function makeQuerySub(
  event: string,
  handler: SyncSubscriberEntry['handler'],
  priority = 50,
  id = 'sub-1',
): SyncSubscriberEntry {
  return {
    metadata: { event, sync: true, priority, id },
    handler,
  }
}

beforeEach(() => {
  registerSyncSubscribers([])
  registerResponseEnrichers([])
})

// ---------------------------------------------------------------------------
// entityIdToEventEntity
// ---------------------------------------------------------------------------

describe('entityIdToEventEntity', () => {
  it('converts colon-separated to dot-separated', () => {
    expect(entityIdToEventEntity('customers:person')).toBe('customers.person')
  })

  it('passes through already dot-separated', () => {
    expect(entityIdToEventEntity('customers.person')).toBe('customers.person')
  })

  it('handles nested colons', () => {
    expect(entityIdToEventEntity('mod:sub:entity')).toBe('mod.sub.entity')
  })
})

// ---------------------------------------------------------------------------
// collectQuerySubscribers
// ---------------------------------------------------------------------------

describe('collectQuerySubscribers', () => {
  it('collects subscribers matching a querying event', () => {
    const sub1 = makeQuerySub('customers.person.querying', jest.fn(), 10, 's1')
    const sub2 = makeQuerySub('other.entity.querying', jest.fn(), 10, 's2')
    registerSyncSubscribers([sub1, sub2])

    const result = collectQuerySubscribers('customers.person.querying')
    expect(result).toHaveLength(1)
    expect(result[0].metadata.id).toBe('s1')
  })

  it('supports wildcard patterns', () => {
    const sub = makeQuerySub('customers.*.querying', jest.fn(), 10, 'wildcard')
    registerSyncSubscribers([sub])

    const result = collectQuerySubscribers('customers.person.querying')
    expect(result).toHaveLength(1)
  })

  it('sorts by priority ascending', () => {
    const sub1 = makeQuerySub('customers.person.querying', jest.fn(), 90, 'low')
    const sub2 = makeQuerySub('customers.person.querying', jest.fn(), 10, 'high')
    registerSyncSubscribers([sub1, sub2])

    const result = collectQuerySubscribers('customers.person.querying')
    expect(result.map((s) => s.metadata.id)).toEqual(['high', 'low'])
  })
})

// ---------------------------------------------------------------------------
// runBeforeQueryEvent
// ---------------------------------------------------------------------------

describe('runBeforeQueryEvent', () => {
  it('returns ok when no subscribers exist', async () => {
    const payload = makeQueryPayload()
    const result = await runBeforeQueryEvent(payload, ctx)
    expect(result.ok).toBe(true)
    expect(result.modifiedQuery).toBeUndefined()
  })

  it('returns ok when subscriber does not block', async () => {
    registerSyncSubscribers([
      makeQuerySub('customers.person.querying', jest.fn().mockResolvedValue(undefined)),
    ])
    const payload = makeQueryPayload()
    const result = await runBeforeQueryEvent(payload, ctx)
    expect(result.ok).toBe(true)
  })

  it('blocks query when subscriber returns ok: false', async () => {
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.querying',
        jest.fn().mockResolvedValue({ ok: false, message: 'Denied', status: 403 }),
      ),
    ])
    const payload = makeQueryPayload()
    const result = await runBeforeQueryEvent(payload, ctx)
    expect(result.ok).toBe(false)
    expect(result.errorMessage).toBe('Denied')
    expect(result.errorStatus).toBe(403)
  })

  it('modifies query options through subscriber', async () => {
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.querying',
        jest.fn().mockResolvedValue({
          ok: true,
          modifiedQuery: { filters: { assigned_user_id: 'user-1' } },
        }),
      ),
    ])
    const payload = makeQueryPayload()
    const result = await runBeforeQueryEvent(payload, ctx)
    expect(result.ok).toBe(true)
    expect(result.modifiedQuery).toBeDefined()
    expect((result.modifiedQuery as Record<string, unknown>).filters).toEqual({ assigned_user_id: 'user-1' })
  })

  it('accumulates query modifications across subscribers', async () => {
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.querying',
        jest.fn().mockResolvedValue({
          ok: true,
          modifiedQuery: { filters: { status: 'active' } },
        }),
        10,
        's1',
      ),
      makeQuerySub(
        'customers.person.querying',
        jest.fn(async (payload: SyncQueryEventPayload) => {
          return {
            ok: true,
            modifiedQuery: {
              filters: { ...(payload.query.filters as Record<string, unknown>), role: 'admin' },
            },
          }
        }),
        20,
        's2',
      ),
    ])
    const payload = makeQueryPayload()
    const result = await runBeforeQueryEvent(payload, ctx)
    expect(result.ok).toBe(true)
    expect((result.modifiedQuery as Record<string, unknown>).filters).toEqual({
      status: 'active',
      role: 'admin',
    })
  })

  it('stops on first blocking subscriber', async () => {
    const handler2 = jest.fn()
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.querying',
        jest.fn().mockResolvedValue({ ok: false, message: 'Blocked' }),
        10,
        's1',
      ),
      makeQuerySub('customers.person.querying', handler2, 20, 's2'),
    ])
    const payload = makeQueryPayload()
    const result = await runBeforeQueryEvent(payload, ctx)
    expect(result.ok).toBe(false)
    expect(handler2).not.toHaveBeenCalled()
  })

  it('catches thrown errors and returns blocked', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.querying',
        jest.fn().mockRejectedValue(new Error('kaboom')),
        10,
        'bad-sub',
      ),
    ])
    const payload = makeQueryPayload()
    const result = await runBeforeQueryEvent(payload, ctx)
    expect(result.ok).toBe(false)
    expect(result.errorStatus).toBe(500)
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// runAfterQueryEvent
// ---------------------------------------------------------------------------

describe('runAfterQueryEvent', () => {
  function makeQueriedPayload(): SyncQueryEventPayload {
    return makeQueryPayload({
      eventId: 'customers.person.queried',
      timing: 'after',
      result: {
        items: [{ id: '1', name: 'Alice' }],
        page: 1,
        pageSize: 50,
        total: 1,
      },
    })
  }

  it('returns empty when no subscribers exist', async () => {
    const payload = makeQueriedPayload()
    const result = await runAfterQueryEvent(payload, ctx)
    expect(result.modifiedResult).toBeUndefined()
  })

  it('modifies result through subscriber', async () => {
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.queried',
        jest.fn().mockResolvedValue({
          modifiedResult: {
            items: [{ id: '1', name: 'Alice (modified)' }],
            page: 1,
            pageSize: 50,
            total: 1,
          },
        }),
      ),
    ])
    const payload = makeQueriedPayload()
    const result = await runAfterQueryEvent(payload, ctx)
    expect(result.modifiedResult).toBeDefined()
    expect(result.modifiedResult!.items[0].name).toBe('Alice (modified)')
  })

  it('rejects invalid modifiedResult shape', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.queried',
        jest.fn().mockResolvedValue({
          modifiedResult: { bad: 'shape' },
        }),
      ),
    ])
    const payload = makeQueriedPayload()
    const result = await runAfterQueryEvent(payload, ctx)
    expect(result.modifiedResult).toBeUndefined()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid modifiedResult shape'),
    )
    consoleSpy.mockRestore()
  })

  it('continues on subscriber error', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    const handler2 = jest.fn().mockResolvedValue({
      modifiedResult: {
        items: [{ id: '1', transformed: true }],
        page: 1,
        pageSize: 50,
        total: 1,
      },
    })
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.queried',
        jest.fn().mockRejectedValue(new Error('boom')),
        10,
        'bad',
      ),
      makeQuerySub('customers.person.queried', handler2, 20, 'good'),
    ])
    const payload = makeQueriedPayload()
    const result = await runAfterQueryEvent(payload, ctx)
    expect(handler2).toHaveBeenCalled()
    expect(result.modifiedResult).toBeDefined()
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// reapplyScopeGuards
// ---------------------------------------------------------------------------

describe('reapplyScopeGuards', () => {
  it('overwrites tenantId and organizationId', () => {
    const query = { tenantId: 'evil-tenant', organizationId: 'evil-org' }
    const result = reapplyScopeGuards(query, 'safe-tenant', 'safe-org')
    expect(result.tenantId).toBe('safe-tenant')
    expect(result.organizationId).toBe('safe-org')
  })

  it('does not set organizationId when null', () => {
    const query = { tenantId: 't1', organizationId: 'org-1' }
    const result = reapplyScopeGuards(query, 'safe-tenant', null)
    expect(result.tenantId).toBe('safe-tenant')
    expect(result.organizationId).toBe('org-1')
  })

  it('preserves other query options', () => {
    const query = { tenantId: 't1', fields: ['id', 'name'], page: { page: 2, pageSize: 25 } }
    const result = reapplyScopeGuards(query, 'safe-tenant', 'safe-org')
    expect(result.fields).toEqual(['id', 'name'])
    expect(result.page).toEqual({ page: 2, pageSize: 25 })
  })
})

// ---------------------------------------------------------------------------
// applyQueryLevelEnrichers
// ---------------------------------------------------------------------------

describe('applyQueryLevelEnrichers', () => {
  function makeEnricher(
    overrides: Partial<ResponseEnricher> & { id: string; targetEntity: string },
  ): ResponseEnricher {
    return {
      priority: 0,
      async enrichOne(record) {
        return record
      },
      ...overrides,
    }
  }

  it('returns items unchanged when no query-engine enrichers exist', async () => {
    const items = [{ id: '1', name: 'Alice' }]
    const enricherCtx = {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      em: {},
      container: {},
    }
    const result = await applyQueryLevelEnrichers(items, 'customers.person', 'basic', enricherCtx)
    expect(result.items).toEqual(items)
    expect(result.enrichedBy).toEqual([])
  })

  it('applies query-engine enabled enrichers', async () => {
    registerResponseEnrichers([
      {
        moduleId: 'example',
        enrichers: [
          makeEnricher({
            id: 'example.tier',
            targetEntity: 'customers.person',
            queryEngine: { enabled: true },
            async enrichMany(records) {
              return records.map((r) => ({ ...r, _example: { tier: 'gold' } }))
            },
          }),
        ],
      },
    ])

    const items = [{ id: '1', name: 'Alice' }]
    const enricherCtx = {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      em: {},
      container: {},
    }
    const result = await applyQueryLevelEnrichers(items, 'customers.person', 'basic', enricherCtx)
    expect(result.items[0]).toHaveProperty('_example')
    expect((result.items[0] as Record<string, unknown>)._example).toEqual({ tier: 'gold' })
    expect(result.enrichedBy).toContain('example.tier')
  })

  it('skips enrichers not enabled for the engine type', async () => {
    registerResponseEnrichers([
      {
        moduleId: 'example',
        enrichers: [
          makeEnricher({
            id: 'example.hybrid-only',
            targetEntity: 'customers.person',
            queryEngine: { enabled: true, engines: ['hybrid'] },
            async enrichMany(records) {
              return records.map((r) => ({ ...r, _example: { enriched: true } }))
            },
          }),
        ],
      },
    ])

    const items = [{ id: '1', name: 'Alice' }]
    const enricherCtx = {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      em: {},
      container: {},
    }
    const result = await applyQueryLevelEnrichers(items, 'customers.person', 'basic', enricherCtx)
    expect(result.enrichedBy).toEqual([])
  })

  it('excludes API-only enrichers from query-engine pipeline', async () => {
    const apiOnlyEnrichMany = jest.fn(async (records: Record<string, unknown>[]) =>
      records.map((r) => ({ ...r, _apiOnly: true })),
    )
    registerResponseEnrichers([
      {
        moduleId: 'example',
        enrichers: [
          makeEnricher({
            id: 'example.api-only',
            targetEntity: 'customers.person',
            priority: 10,
            enrichMany: apiOnlyEnrichMany,
          }),
          makeEnricher({
            id: 'example.query-enabled',
            targetEntity: 'customers.person',
            priority: 5,
            queryEngine: { enabled: true },
            async enrichMany(records) {
              return records.map((r) => ({ ...r, _queryEngine: true }))
            },
          }),
        ],
      },
    ])

    const items = [{ id: '1', name: 'Alice' }]
    const enricherCtx = {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      em: {},
      container: {},
    }
    const result = await applyQueryLevelEnrichers(items, 'customers.person', 'basic', enricherCtx)
    expect(result.enrichedBy).toEqual(['example.query-enabled'])
    expect(apiOnlyEnrichMany).not.toHaveBeenCalled()
    expect(result.items[0]).toHaveProperty('_queryEngine', true)
    expect(result.items[0]).not.toHaveProperty('_apiOnly')
  })

  it('respects applyOn filter', async () => {
    registerResponseEnrichers([
      {
        moduleId: 'example',
        enrichers: [
          makeEnricher({
            id: 'example.list-only',
            targetEntity: 'customers.person',
            queryEngine: { enabled: true, applyOn: ['list'] },
            async enrichMany(records) {
              return records.map((r) => ({ ...r, _example: { enriched: true } }))
            },
          }),
        ],
      },
    ])

    const items = [{ id: '1', name: 'Alice' }]
    const enricherCtx = {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      em: {},
      container: {},
    }

    const listResult = await applyQueryLevelEnrichers(
      items, 'customers.person', 'basic', enricherCtx, 'list',
    )
    expect(listResult.enrichedBy).toContain('example.list-only')

    const detailResult = await applyQueryLevelEnrichers(
      items, 'customers.person', 'basic', enricherCtx, 'detail',
    )
    expect(detailResult.enrichedBy).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Pipeline integration (runBeforeQueryPipeline + runAfterQueryPipeline)
// ---------------------------------------------------------------------------

describe('runBeforeQueryPipeline', () => {
  it('passes through query unchanged when no subscribers exist', async () => {
    const query = { tenantId: 'tenant-1', organizationId: 'org-1' }
    const extensionCtx = {
      entity: 'customers:person',
      engine: 'basic' as const,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      em: {},
    }
    const result = await runBeforeQueryPipeline(query, extensionCtx, ctx)
    expect(result.blocked).toBe(false)
    expect(result.query).toEqual(query)
  })

  it('blocks when subscriber rejects', async () => {
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.querying',
        jest.fn().mockResolvedValue({ ok: false, message: 'Nope' }),
      ),
    ])
    const query = { tenantId: 'tenant-1', organizationId: 'org-1' }
    const extensionCtx = {
      entity: 'customers:person',
      engine: 'basic' as const,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      em: {},
    }
    const result = await runBeforeQueryPipeline(query, extensionCtx, ctx)
    expect(result.blocked).toBe(true)
    expect(result.errorMessage).toBe('Nope')
  })

  it('re-applies scope guards after modification', async () => {
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.querying',
        jest.fn().mockResolvedValue({
          ok: true,
          modifiedQuery: { tenantId: 'hacked-tenant', organizationId: 'hacked-org' },
        }),
      ),
    ])
    const query = { tenantId: 'tenant-1', organizationId: 'org-1' }
    const extensionCtx = {
      entity: 'customers:person',
      engine: 'basic' as const,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      em: {},
    }
    const result = await runBeforeQueryPipeline(query, extensionCtx, ctx)
    expect(result.blocked).toBe(false)
    expect(result.query.tenantId).toBe('tenant-1')
    expect(result.query.organizationId).toBe('org-1')
  })
})

describe('runAfterQueryPipeline', () => {
  it('passes through result unchanged when no extensions exist', async () => {
    const queryResult: QueryResult<Record<string, unknown>> = {
      items: [{ id: '1', name: 'Alice' }],
      page: 1,
      pageSize: 50,
      total: 1,
    }
    const extensionCtx = {
      entity: 'customers:person',
      engine: 'basic' as const,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      em: {},
      container: {},
    }
    const result = await runAfterQueryPipeline(queryResult, {}, extensionCtx, ctx)
    expect(result.items).toEqual(queryResult.items)
  })

  it('applies enrichers and after-query subscribers', async () => {
    registerResponseEnrichers([
      {
        moduleId: 'example',
        enrichers: [
          {
            id: 'example.tier',
            targetEntity: 'customers.person',
            priority: 10,
            queryEngine: { enabled: true },
            async enrichOne(record: Record<string, unknown>) {
              return { ...record, _example: { tier: 'gold' } }
            },
            async enrichMany(records: Record<string, unknown>[]) {
              return records.map((r) => ({ ...r, _example: { tier: 'gold' } }))
            },
          },
        ],
      },
    ])
    registerSyncSubscribers([
      makeQuerySub(
        'customers.person.queried',
        jest.fn().mockImplementation(async (payload: SyncQueryEventPayload) => {
          return {
            modifiedResult: {
              ...payload.result,
              items: payload.result!.items.map((item) => ({
                ...item,
                _subscriber: { touched: true },
              })),
            },
          }
        }),
      ),
    ])

    const queryResult: QueryResult<Record<string, unknown>> = {
      items: [{ id: '1', name: 'Alice' }],
      page: 1,
      pageSize: 50,
      total: 1,
    }
    const extensionCtx = {
      entity: 'customers:person',
      engine: 'basic' as const,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      em: {},
      container: {},
    }
    const result = await runAfterQueryPipeline(queryResult, {}, extensionCtx, ctx)
    expect(result.items[0]).toHaveProperty('_example')
    expect(result.items[0]).toHaveProperty('_subscriber')
  })
})
