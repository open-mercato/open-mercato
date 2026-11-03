import { forwardEventToCampaigns } from '../lib/subscriber-forward.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

export const metadata = {
  event: 'sales.order.confirmed',
  persistent: true,
  id: 'marketing_automation:order-confirmed',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await forwardEventToCampaigns('sales.order.confirmed', payload, ctx)
}
