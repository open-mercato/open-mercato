import { forwardEventToCampaigns } from '../lib/subscriber-forward.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

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
