import { forwardEventToCampaigns } from '../lib/subscriber-forward.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

export const metadata = {
  event: 'customers.deal.lost',
  persistent: true,
  id: 'marketing_automation:deal-lost',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await forwardEventToCampaigns('customers.deal.lost', payload, ctx)
}
