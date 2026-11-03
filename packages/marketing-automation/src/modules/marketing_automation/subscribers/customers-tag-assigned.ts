import { forwardEventToCampaigns } from '../lib/subscriber-forward.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

export const metadata = {
  event: 'customers.tag.assigned',
  persistent: true,
  id: 'marketing_automation:tag-assigned',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await forwardEventToCampaigns('customers.tag.assigned', payload, ctx)
}
