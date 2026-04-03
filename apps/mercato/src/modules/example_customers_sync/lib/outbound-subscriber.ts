import { getExampleCustomersSyncQueue, EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_QUEUE } from '../lib/queue'
import { shouldEnqueueOutboundSync } from '../lib/sync'
import { resolveExampleCustomersSyncFlags } from '../lib/toggles'

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

type OutboundPayload = {
  id?: string | null
  interactionType?: string | null
  tenantId?: string | null
  organizationId?: string | null
  syncOrigin?: string | null
}

export function createOutboundSubscriber(eventName: string) {
  return async function handle(payload: OutboundPayload, ctx: ResolverContext): Promise<void> {
    if (!shouldEnqueueOutboundSync(payload)) return
    const flags = await resolveExampleCustomersSyncFlags(ctx, payload.tenantId)
    if (!flags.enabled) return
    const queue = getExampleCustomersSyncQueue(EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_QUEUE)
    await queue.enqueue({
      eventId: eventName,
      interactionId: payload.id,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
  }
}
