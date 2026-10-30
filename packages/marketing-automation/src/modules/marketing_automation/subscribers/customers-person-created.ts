import { forwardEventToCampaigns } from '../lib/subscriber-forward.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

export const metadata = {
  event: 'customers.person.created',
  persistent: true,
  id: 'marketing_automation:person-created',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await forwardEventToCampaigns('customers.person.created', payload, ctx)
}
