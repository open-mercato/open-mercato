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
    { id: 'coalesce_test.recipient.created', label: 'Recipient Created', clientBroadcast: true, broadcastCoalescing: true },
    { id: 'coalesce_test.portal.created', label: 'Portal Created', portalBroadcast: true, broadcastCoalescing: true },
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

  it('never delivers one recipient user\'s payload under another recipient user\'s key', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const seen: Array<{ recipientUserId: string; id: string }> = []
    unregisterTap = registerGlobalEventTap((_event, payload) => {
      const data = payload as { id: string; recipientUserId: string }
      seen.push({ recipientUserId: data.recipientUserId, id: data.id })
    })

    // Same tenant/org for both users — options carry no recipient dimension at
    // all, so only the payload-derived union in the coalescing key can keep
    // these two audiences from suppressing each other.
    const users = ['user-a', 'user-b']
    for (let round = 0; round < 5; round += 1) {
      for (const recipientUserId of users) {
        await bus.emit(
          'coalesce_test.recipient.created',
          { id: `${recipientUserId}-${round}`, tenantId: 'tenant-1', organizationId: 'org-1', recipientUserId },
          { tenantId: 'tenant-1', organizationId: 'org-1' },
        )
      }
    }
    await wait(INTERVAL_MS * 2)

    for (const recipientUserId of users) {
      const forUser = seen.filter((entry) => entry.recipientUserId === recipientUserId)
      expect(forUser.length).toBeGreaterThanOrEqual(2)
      expect(forUser[forUser.length - 1].id).toBe(`${recipientUserId}-4`)
      for (const entry of forUser) {
        expect(entry.id.startsWith(`${recipientUserId}-`)).toBe(true)
      }
    }
  })

  it('never delivers one recipient role\'s payload under another recipient role\'s key', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const seen: Array<{ recipientRoleId: string; id: string }> = []
    unregisterTap = registerGlobalEventTap((_event, payload) => {
      const data = payload as { id: string; recipientRoleId: string }
      seen.push({ recipientRoleId: data.recipientRoleId, id: data.id })
    })

    const roles = ['role-a', 'role-b']
    for (let round = 0; round < 5; round += 1) {
      for (const recipientRoleId of roles) {
        await bus.emit(
          'coalesce_test.recipient.created',
          { id: `${recipientRoleId}-${round}`, tenantId: 'tenant-1', organizationId: 'org-1', recipientRoleId },
          { tenantId: 'tenant-1', organizationId: 'org-1' },
        )
      }
    }
    await wait(INTERVAL_MS * 2)

    for (const recipientRoleId of roles) {
      const forRole = seen.filter((entry) => entry.recipientRoleId === recipientRoleId)
      expect(forRole.length).toBeGreaterThanOrEqual(2)
      expect(forRole[forRole.length - 1].id).toBe(`${recipientRoleId}-4`)
      for (const entry of forRole) {
        expect(entry.id.startsWith(`${recipientRoleId}-`)).toBe(true)
      }
    }
  })

  it('never delivers one tenant\'s payload under another tenant\'s key for a portal-only event', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const seen: Array<{ tenantId: string; id: string }> = []
    unregisterTap = registerGlobalEventTap((_event, payload) => {
      const data = payload as { id: string; tenantId: string }
      seen.push({ tenantId: data.tenantId, id: data.id })
    })

    // A portal-only broadcast has no `clientBroadcast`, so `resolveCrossProcessEmitOptions`
    // never promotes payload scope into options for it — the coalescing key can
    // only be correct here if it reads tenantId straight off the payload, the
    // way this test never passes it in `options` at all.
    const tenants = ['tenant-a', 'tenant-b']
    for (let round = 0; round < 5; round += 1) {
      for (const tenantId of tenants) {
        await bus.emit(
          'coalesce_test.portal.created',
          { id: `${tenantId}-${round}`, tenantId },
        )
      }
    }
    await wait(INTERVAL_MS * 2)

    for (const tenantId of tenants) {
      const forTenant = seen.filter((entry) => entry.tenantId === tenantId)
      expect(forTenant.length).toBeGreaterThanOrEqual(2)
      expect(forTenant[forTenant.length - 1].id).toBe(`${tenantId}-4`)
      for (const entry of forTenant) {
        expect(entry.id.startsWith(`${tenantId}-`)).toBe(true)
      }
    }
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

  it('restores the develop dispatch order (pg_notify publish after inline) when the interval is disabled', async () => {
    process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = '0'
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    const order: string[] = []
    bus.on('coalesce_test.bulk.created', async () => {
      order.push('inline')
    })
    publishCrossProcessEventMock.mockImplementationOnce(async () => {
      order.push('publish')
    })

    // On the non-coalesced path (and on develop before this feature existed),
    // the pg_notify publish that reaches other processes always ran AFTER inline
    // in-memory delivery. The coalesced path bundles it with the tap dispatch
    // instead, ahead of inline delivery — `OM_BROADCAST_COALESCE_INTERVAL_MS=0`
    // promises to fully restore the develop order, not merely the per-record
    // delivery count.
    await bus.emit(
      'coalesce_test.bulk.created',
      { id: 'product-0', tenantId: 'tenant-1', organizationId: 'org-1' },
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )

    expect(order).toEqual(['inline', 'publish'])
  })
})
