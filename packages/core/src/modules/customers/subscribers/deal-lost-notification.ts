import {
  deliverDealClosureNotification,
  type DealClosurePayload,
} from '../lib/dealClosureNotification'

export const metadata = {
  event: 'customers.deal.lost',
  persistent: true,
  id: 'customers:deal-lost-notification',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
}

export default async function handleDealLost(
  payload: DealClosurePayload,
  ctx: ResolverContext,
): Promise<void> {
  await deliverDealClosureNotification(payload, ctx, 'customers.deal.lost')
}
