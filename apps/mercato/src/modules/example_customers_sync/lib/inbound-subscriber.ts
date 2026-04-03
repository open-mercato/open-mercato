import { getExampleCustomersSyncQueue, EXAMPLE_CUSTOMERS_SYNC_INBOUND_QUEUE } from '../lib/queue'
import { shouldEnqueueInboundSync } from '../lib/sync'
import { resolveExampleCustomersSyncFlags } from '../lib/toggles'

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

type InboundPayload = {
  id?: string | null
  tenantId?: string | null
  organizationId?: string | null
  syncOrigin?: string | null
}

export function createInboundSubscriber(eventName: string) {
  return async function handle(payload: InboundPayload, ctx: ResolverContext): Promise<void> {
    if (!shouldEnqueueInboundSync(payload)) return
    const flags = await resolveExampleCustomersSyncFlags(ctx, payload.tenantId)
    if (!flags.enabled || !flags.bidirectional) return
    const queue = getExampleCustomersSyncQueue(EXAMPLE_CUSTOMERS_SYNC_INBOUND_QUEUE)
    await queue.enqueue({
      eventId: eventName,
      todoId: payload.id,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
  }
}
