import { getExampleCustomersSyncQueue, EXAMPLE_CUSTOMERS_SYNC_INBOUND_QUEUE } from '../lib/queue'
import { shouldEnqueueInboundSync } from '../lib/sync'
import { resolveExampleCustomersSyncFlags } from '../lib/toggles'

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
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
    if (typeof ctx.tenantId !== 'string' || typeof ctx.organizationId !== 'string') return
    if (payload.tenantId !== ctx.tenantId || payload.organizationId !== ctx.organizationId) return
    const flags = await resolveExampleCustomersSyncFlags(ctx, ctx.tenantId)
    if (!flags.enabled || !flags.bidirectional) return
    const queue = getExampleCustomersSyncQueue(EXAMPLE_CUSTOMERS_SYNC_INBOUND_QUEUE)
    await queue.enqueue({
      eventId: eventName,
      todoId: payload.id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }
}
