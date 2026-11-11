import { forwardEventToCampaigns } from '../lib/subscriber-forward.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

/**
 * A converted referral, forwarded to campaigns.
 *
 * The subject of this event is the REFERRER, not the person who bought — that is the whole trick of a referral
 * programme, and the reason it needs an event of its own rather than reusing `sales.order.created`.
 */
export const metadata = {
  event: 'marketing_automation.referral.converted',
  persistent: true,
  id: 'marketing_automation:referral-converted',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await forwardEventToCampaigns('marketing_automation.referral.converted', payload, ctx)
}
