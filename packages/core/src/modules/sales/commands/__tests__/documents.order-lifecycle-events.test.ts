/** @jest-environment node */

import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import type { SalesOrder } from '../../data/entities'
import { emitOrderLifecycleEventsForTransition } from '../documents'

const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type EmittedEvent = { event: string; payload: unknown; options: unknown }

function buildOrder(status: string): SalesOrder {
  return {
    id: ORDER_ID,
    orderNumber: 'SO-1001',
    status,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  } as SalesOrder
}

async function flushEmits(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('sales order lifecycle events carry trusted scope', () => {
  let emitted: EmittedEvent[]

  beforeEach(() => {
    emitted = []
    setGlobalEventBus({
      emit: async (event: string, payload: unknown, options?: unknown) => {
        emitted.push({ event, payload, options })
      },
    })
  })

  it('emits sales.order.confirmed with the order tenant and organization as emit options', async () => {
    emitOrderLifecycleEventsForTransition({ order: buildOrder('confirmed'), previousStatus: 'draft' })
    await flushEmits()

    expect(emitted).toHaveLength(1)
    expect(emitted[0].event).toBe('sales.order.confirmed')
    expect(emitted[0].options).toEqual(expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID }))
    expect(emitted[0].payload).toEqual(expect.objectContaining({
      id: ORDER_ID,
      orderId: ORDER_ID,
      status: 'confirmed',
      previousStatus: 'draft',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    }))
  })

  it('emits sales.order.cancelled with the order tenant and organization as emit options', async () => {
    emitOrderLifecycleEventsForTransition({ order: buildOrder('cancelled'), previousStatus: 'confirmed' })
    await flushEmits()

    expect(emitted).toHaveLength(1)
    expect(emitted[0].event).toBe('sales.order.cancelled')
    expect(emitted[0].options).toEqual(expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID }))
  })

  it('emits nothing when the status did not change', async () => {
    emitOrderLifecycleEventsForTransition({ order: buildOrder('confirmed'), previousStatus: 'confirmed' })
    await flushEmits()

    expect(emitted).toHaveLength(0)
  })
})
