/**
 * Guards the #5733 contract for the catalog product broadcast events: a bulk
 * writer emitting one event per record must keep per-record domain delivery
 * while its browser deliveries collapse, and the burst must end on the final
 * record so an open DataTable is not left stale.
 */

const publishCrossProcessEventMock = jest.fn(async () => undefined)

jest.mock('@open-mercato/events/bridge', () => ({
  publishCrossProcessEvent: (...args: unknown[]) => publishCrossProcessEventMock(...args),
  registerCrossProcessEventListener: jest.fn(),
  CROSS_PROCESS_EVENT_INSTANCE_ID: 'test-instance',
}))

import { isBroadcastEvent, isCoalescedBroadcastEvent, setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { createEventBus, registerGlobalEventTap } from '@open-mercato/events/bus'
import { resetBroadcastCoalescerForTests } from '@open-mercato/events/broadcast-coalescer'
import catalogEventsConfig from '../events'

const INTERVAL_MS = 50
const BULK_SIZE = 200

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('catalog product broadcast coalescing', () => {
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
    setGlobalEventBus(null as never)
    if (originalInterval === undefined) delete process.env.OM_BROADCAST_COALESCE_INTERVAL_MS
    else process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = originalInterval
  })

  it('declares coalescing on exactly the three product events that reach the browser', () => {
    for (const eventId of ['catalog.product.created', 'catalog.product.updated', 'catalog.product.deleted']) {
      expect(isBroadcastEvent(eventId)).toBe(true)
      expect(isCoalescedBroadcastEvent(eventId)).toBe(true)
    }

    for (const eventId of [
      'catalog.category.created',
      'catalog.variant.created',
      'catalog.price.created',
      'catalog.product.stock_low',
    ]) {
      expect(isCoalescedBroadcastEvent(eventId)).toBe(false)
    }
  })

  it('keeps one domain delivery per record while the browser sees a handful', async () => {
    const bus = createEventBus({ resolve, queueStrategy: 'local' })
    setGlobalEventBus(bus)

    const subscriberIds: string[] = []
    const browserIds: string[] = []
    bus.on('catalog.product.created', async (payload) => {
      subscriberIds.push(String((payload as { id: string }).id))
    })
    unregisterTap = registerGlobalEventTap((_event, payload) => {
      browserIds.push(String((payload as { id: string }).id))
    })

    for (let index = 0; index < BULK_SIZE; index += 1) {
      await catalogEventsConfig.emit(
        'catalog.product.created',
        { id: `product-${index}`, tenantId: 'tenant-1', organizationId: 'org-1' },
      )
    }
    await wait(INTERVAL_MS * 2)

    // Webhooks, notification handlers, workflow triggers and the indexer all hang
    // off this path: it must stay one delivery per row.
    expect(subscriberIds).toHaveLength(BULK_SIZE)

    // The browser half is what the issue asked to bound.
    expect(browserIds.length).toBeLessThan(BULK_SIZE / 2)
    expect(publishCrossProcessEventMock.mock.calls.length).toBe(browserIds.length)

    // And the burst ends on the last row, so a DataTable refetching on the final
    // frame sees the finished import.
    expect(browserIds[browserIds.length - 1]).toBe(`product-${BULK_SIZE - 1}`)
  })
})
