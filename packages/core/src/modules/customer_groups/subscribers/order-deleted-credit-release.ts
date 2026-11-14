import { handleOrderCreditRelease } from './order-cancelled-credit-release'

type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

// #8406: deleting an on-account order removed the order row but left its credit exposure
// reserved forever — nothing subscribed to `sales.order.deleted` to release it, unlike
// `sales.order.cancelled`. Reuses the sibling's exact release logic: the lookup is scoped
// purely by `linkedOrderId`/`tenantId`/`organizationId` on `CustomerCreditLedgerEntry`,
// which has no FK to the order row, so it still finds the reservation after the order is
// gone. Idempotent by construction via `releaseCredit` (a no-op on redelivery), same as
// `order-cancelled-credit-release.ts`.
export const metadata = {
  event: 'sales.order.deleted',
  persistent: true,
  id: 'customer_groups:order-deleted-credit-release',
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  return handleOrderCreditRelease(payload, ctx, { eventId: 'sales.order.deleted' })
}
