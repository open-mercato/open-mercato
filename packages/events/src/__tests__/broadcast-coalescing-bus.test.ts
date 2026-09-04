const publishCrossProcessEventMock = jest.fn(async () => undefined)

jest.mock('../bridge', () => ({
  publishCrossProcessEvent: (...args: unknown[]) => publishCrossProcessEventMock(...args),
  registerCrossProcessEventListener: jest.fn(),
  CROSS_PROCESS_EVENT_INSTANCE_ID: 'test-instance',
}))

import { createModuleEvents } from '@open-mercato/shared/modules/events'
import { createEventBus, registerGlobalEventTap } from '@open-mercato/events/bus'
import { resetBroadcastCoalescerForTests } from '@open-mercato/events/broadcast-coalescer'

const INTERVAL_MS = 50

createModuleEvents({
  moduleId: 'coalesce_test',
  events: [
    { id: 'coalesce_test.bulk.created', label: 'Bulk Created', clientBroadcast: true, broadcastCoalescing: true },
    { id: 'coalesce_test.plain.created', label: 'Plain Created', clientBroadcast: true },
  ] as const,
})

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('event bus browser-delivery coalescing', () => {
  const resolve = ((name: string) => name) as never
  const originalInterval = process.env.OM_BROADCAST_COALESCE_INTERVAL_MS
  let unregisterTap: (() => void) | null = null

  beforeEach(() => {
    publishCrossProcessEventMock.mockClear()
    process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = String(INTERVAL_MS)
  })

  afterEach(() => {
    unregisterTap?.()
    unregisterTap = null
    resetBroadcastCoalescerForTests()
    if (originalInterval === undefined) delete process.env.OM_BROADCAST_COALESCE_INTERVAL_MS
    else process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = originalInterval
  })

  it('keeps domain delivery per record while collapsing the browser dispatch', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const subscriberCalls: string[] = []
    const tappedIds: string[] = []

    bus.on('coalesce_test.bulk.created', async (payload) => {
      subscriberCalls.push(String((payload as { id: string }).id))
    })
    unregisterTap = registerGlobalEventTap((_event, payload) => {
      tappedIds.push(String((payload as { id: string }).id))
    })

    for (let index = 0; index < 100; index += 1) {
      await bus.emit(
        'coalesce_test.bulk.created',
        { id: `product-${index}`, tenantId: 'tenant-1', organizationId: 'org-1' },
        { tenantId: 'tenant-1', organizationId: 'org-1' },
      )
    }
    await wait(INTERVAL_MS * 2)

    // The hard requirement from the issue: the domain event still fires once per
    // record, so webhooks, notification handlers and indexers are untouched.
    expect(subscriberCalls).toHaveLength(100)
    expect(subscriberCalls[0]).toBe('product-0')
    expect(subscriberCalls[99]).toBe('product-99')

    // The browser half collapses, and the burst still ends on the final record.
    expect(tappedIds.length).toBeLessThan(100)
    expect(tappedIds[0]).toBe('product-0')
    expect(tappedIds[tappedIds.length - 1]).toBe('product-99')

    // The pg_notify roundtrip collapses with it — half the cost the issue names.
    expect(publishCrossProcessEventMock.mock.calls.length).toBe(tappedIds.length)
  })

  it('leaves an event that did not opt in on the per-record path', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const tappedIds: string[] = []
    unregisterTap = registerGlobalEventTap((_event, payload) => {
      tappedIds.push(String((payload as { id: string }).id))
    })

    for (let index = 0; index < 10; index += 1) {
      await bus.emit(
        'coalesce_test.plain.created',
        { id: `product-${index}`, tenantId: 'tenant-1', organizationId: 'org-1' },
        { tenantId: 'tenant-1', organizationId: 'org-1' },
      )
    }

    expect(tappedIds).toHaveLength(10)
    expect(publishCrossProcessEventMock).toHaveBeenCalledTimes(10)
  })

  it('never delivers one tenant or organization payload under another scope', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const seen: Array<{ tenantId: string; organizationId: string; id: string }> = []
    unregisterTap = registerGlobalEventTap((_event, payload) => {
      const data = payload as { id: string; tenantId: string; organizationId: string }
      seen.push({ tenantId: data.tenantId, organizationId: data.organizationId, id: data.id })
    })

    const scopes = [
      { tenantId: 'tenant-a', organizationId: 'org-1' },
      { tenantId: 'tenant-b', organizationId: 'org-1' },
      { tenantId: 'tenant-a', organizationId: 'org-2' },
    ]

    for (let round = 0; round < 5; round += 1) {
      for (const scope of scopes) {
        await bus.emit(
          'coalesce_test.bulk.created',
          { id: `${scope.tenantId}-${scope.organizationId}-${round}`, ...scope },
          scope,
        )
      }
    }
    await wait(INTERVAL_MS * 2)

    // Every scope gets its own leading edge and its own trailing flush, and no
    // delivered payload ever carries a scope other than the one it was keyed by.
    for (const scope of scopes) {
      const forScope = seen.filter((entry) => entry.tenantId === scope.tenantId && entry.organizationId === scope.organizationId)
      expect(forScope.length).toBeGreaterThanOrEqual(2)
      expect(forScope[forScope.length - 1].id).toBe(`${scope.tenantId}-${scope.organizationId}-4`)
      for (const entry of forScope) {
        expect(entry.id.startsWith(`${scope.tenantId}-${scope.organizationId}-`)).toBe(true)
      }
    }
  })

  it('flushes the tail on a natural exit as well as on a signal', async () => {
    const registered: string[] = []
    const onceSpy = jest.spyOn(process, 'once').mockImplementation(function (this: NodeJS.Process, event: string) {
      registered.push(event)
      return this
    } as never)

    try {
      delete (globalThis as Record<string, unknown>).__openMercatoBroadcastCoalescerShutdown__
      createEventBus({ resolve, queueStrategy: 'local' })
    } finally {
      onceSpy.mockRestore()
    }

    // The trailing timer is unref'd, so a CLI that emits and exits normally never
    // sees a signal — beforeExit is the hook that saves its tail.
    expect(registered).toEqual(expect.arrayContaining(['SIGTERM', 'SIGINT', 'beforeExit']))
  })

  it('restores per-record browser delivery when the interval is disabled', async () => {
    process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = '0'
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const tappedIds: string[] = []
    unregisterTap = registerGlobalEventTap((_event, payload) => {
      tappedIds.push(String((payload as { id: string }).id))
    })

    for (let index = 0; index < 10; index += 1) {
      await bus.emit(
        'coalesce_test.bulk.created',
        { id: `product-${index}`, tenantId: 'tenant-1', organizationId: 'org-1' },
        { tenantId: 'tenant-1', organizationId: 'org-1' },
      )
    }

    expect(tappedIds).toHaveLength(10)
    expect(publishCrossProcessEventMock).toHaveBeenCalledTimes(10)
  })
})
