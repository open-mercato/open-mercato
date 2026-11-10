import { handleOrderUsageRevert } from './order-cancelled-usage-revert'

type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

// #8406: deleting an order that redeemed a promotion/single-use code left the usage
// registered forever — nothing subscribed to `sales.order.deleted` to revert it, unlike
// `sales.order.cancelled`. Reuses the sibling's exact revert logic (`revertUsage` +
// `revertCodeUse`), both keyed purely by `orderId`/`tenantId`/`organizationId` with no FK
// to the order row, so they still find the usage after the order is gone. Idempotent by
// construction, same as `order-cancelled-usage-revert.ts`.
export const metadata = {
  event: 'sales.order.deleted',
  persistent: true,
  id: 'promotions:order-deleted-usage-revert',
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  return handleOrderUsageRevert(payload, ctx, { eventId: 'sales.order.deleted' })
}
