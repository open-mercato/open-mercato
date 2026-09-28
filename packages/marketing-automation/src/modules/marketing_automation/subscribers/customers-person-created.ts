import { forwardEventToCampaigns } from './shared.js'
import type { SubscriberContext } from './shared.js'

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
