import { forwardEventToCampaigns } from './shared.js'
import type { SubscriberContext } from './shared.js'

export const metadata = {
  event: 'sales.order.created',
  persistent: true,
  id: 'marketing_automation:order-created',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await forwardEventToCampaigns('sales.order.created', payload, ctx)
}
