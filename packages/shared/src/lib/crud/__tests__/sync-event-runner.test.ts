import { matchesEventPattern, collectSyncSubscribers, runSyncBeforeEvent, runSyncAfterEvent } from '../sync-event-runner'
import type { SyncSubscriberEntry } from '../sync-subscriber-store'
import type { SyncCrudEventPayload } from '../sync-event-types'

describe('matchesEventPattern', () => {
  it('matches exact event ID', () => {
    expect(matchesEventPattern('example.todo.created', 'example.todo.created')).toBe(true)
    expect(matchesEventPattern('example.todo.created', 'example.todo.updated')).toBe(false)
  })

  it('matches global wildcard', () => {
    expect(matchesEventPattern('*', 'example.todo.created')).toBe(true)
  })

  it('matches prefix wildcard', () => {
    expect(matchesEventPattern('example.todo.*', 'example.todo.created')).toBe(true)
    expect(matchesEventPattern('example.todo.*', 'example.todo.deleted')).toBe(true)
    expect(matchesEventPattern('example.todo.*', 'customers.person.created')).toBe(false)
  })

  it('matches module-level wildcard', () => {
    expect(matchesEventPattern('example.*', 'example.todo.created')).toBe(true)
    expect(matchesEventPattern('example.*', 'example.item.updated')).toBe(true)
  })
})

describe('collectSyncSubscribers', () => {
  function makeSub(event: string, priority = 50, id = 'sub-1'): SyncSubscriberEntry {
    return {
      metadata: { event, sync: true, priority, id },
      handler: jest.fn(),
    }
  }

  it('filters by event pattern', () => {
    const subs = [
      makeSub('example.todo.creating', 50, 's1'),
      makeSub('other.entity.creating', 50, 's2'),
    ]
    const result = collectSyncSubscribers(subs, 'example.todo.creating')
    expect(result).toHaveLength(1)
    expect(result[0].metadata.id).toBe('s1')
  })

  it('sorts by priority ascending', () => {
    const subs = [
      makeSub('example.todo.creating', 90, 'low-pri'),
      makeSub('example.todo.creating', 10, 'high-pri'),
      makeSub('example.todo.creating', 50, 'mid-pri'),
    ]
    const result = collectSyncSubscribers(subs, 'example.todo.creating')
    expect(result.map((s) => s.metadata.id)).toEqual(['high-pri', 'mid-pri', 'low-pri'])
  })
})

describe('runSyncBeforeEvent', () => {
  const basePayload: SyncCrudEventPayload = {
    eventId: 'example.todo.creating',
    entity: 'example.todo',
    operation: 'create',
    timing: 'before',
    resourceId: null,
    payload: { title: 'Test' },
    previousData: null,
    entity_data: null,
    userId: 'user-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    em: {} as any,
    request: {} as any,
  }

  const ctx = { resolve: jest.fn() }

  it('returns ok when no subscribers block', async () => {
    const sub: SyncSubscriberEntry = {
      metadata: { event: 'example.todo.creating', sync: true, id: 's1' },
      handler: jest.fn().mockResolvedValue(undefined),
    }
    const result = await runSyncBeforeEvent([sub], basePayload, ctx)
    expect(result.ok).toBe(true)
  })

  it('stops on first rejection', async () => {
    const s1: SyncSubscriberEntry = {
      metadata: { event: 'example.todo.creating', sync: true, priority: 10, id: 's1' },
      handler: jest.fn().mockResolvedValue({ ok: false, message: 'Blocked', status: 403 }),
    }
    const s2: SyncSubscriberEntry = {
      metadata: { event: 'example.todo.creating', sync: true, priority: 20, id: 's2' },
      handler: jest.fn(),
    }
    const result = await runSyncBeforeEvent([s1, s2], basePayload, ctx)
    expect(result.ok).toBe(false)
    expect(result.errorStatus).toBe(403)
    expect(s2.handler).not.toHaveBeenCalled()
  })

  it('accumulates modified payload across subscribers', async () => {
    const s1: SyncSubscriberEntry = {
      metadata: { event: 'example.todo.creating', sync: true, priority: 10, id: 's1' },
      handler: jest.fn().mockResolvedValue({ ok: true, modifiedPayload: { priority: 'normal' } }),
    }
    const s2: SyncSubscriberEntry = {
      metadata: { event: 'example.todo.creating', sync: true, priority: 20, id: 's2' },
      handler: jest.fn(async (payload) => {
        expect(payload.payload).toEqual({ title: 'Test', priority: 'normal' })
        return { ok: true }
      }),
    }
    const result = await runSyncBeforeEvent([s1, s2], basePayload, ctx)
    expect(result.ok).toBe(true)
    expect(result.modifiedPayload).toEqual({ title: 'Test', priority: 'normal' })
  })

  it('uses default status 422 when not specified', async () => {
    const sub: SyncSubscriberEntry = {
      metadata: { event: 'example.todo.creating', sync: true, id: 's1' },
      handler: jest.fn().mockResolvedValue({ ok: false, message: 'Bad' }),
    }
    const result = await runSyncBeforeEvent([sub], basePayload, ctx)
    expect(result.ok).toBe(false)
    expect(result.errorStatus).toBe(422)
  })
})

describe('runSyncAfterEvent', () => {
  const basePayload: SyncCrudEventPayload = {
    eventId: 'example.todo.created',
    entity: 'example.todo',
    operation: 'create',
    timing: 'after',
    resourceId: 'todo-1',
    payload: { title: 'Test' },
    previousData: null,
    entity_data: null,
    userId: 'user-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    em: {} as any,
    request: {} as any,
  }

  const ctx = { resolve: jest.fn() }

  it('runs all subscribers even if one throws', async () => {
    const s1: SyncSubscriberEntry = {
      metadata: { event: 'example.todo.created', sync: true, priority: 10, id: 's1' },
      handler: jest.fn().mockRejectedValue(new Error('boom')),
    }
    const s2: SyncSubscriberEntry = {
      metadata: { event: 'example.todo.created', sync: true, priority: 20, id: 's2' },
      handler: jest.fn().mockResolvedValue(undefined),
    }

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    await runSyncAfterEvent([s1, s2], basePayload, ctx)
    expect(s2.handler).toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
