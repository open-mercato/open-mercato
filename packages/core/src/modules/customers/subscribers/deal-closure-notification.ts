import {
  deliverDealClosureNotification,
  type DealClosurePayload,
} from '../lib/dealClosureNotification'

export const metadata = {
  event: 'customers.deal.won',
  persistent: true,
  id: 'customers:deal-won-notification',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
}

export default async function handleDealWon(
  payload: DealClosurePayload,
  ctx: ResolverContext,
): Promise<void> {
  await deliverDealClosureNotification(payload, ctx, 'customers.deal.won')
}
