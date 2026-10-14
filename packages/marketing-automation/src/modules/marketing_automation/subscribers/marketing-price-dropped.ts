import { forwardEventToCampaigns } from '../lib/subscriber-forward.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

/**
 * A watched product got cheaper, forwarded to campaigns.
 *
 * The subject is the customer who was waiting, so this is an ordinary forward — unlike the referral
 * conversion, nothing about the subject needs flipping.
 */
export const metadata = {
  event: 'marketing_automation.product.price_dropped',
  persistent: true,
  id: 'marketing_automation:price-dropped',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await forwardEventToCampaigns('marketing_automation.product.price_dropped', payload, ctx)
}
