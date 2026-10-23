import { forwardEventToCampaigns } from '../lib/subscriber-forward.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

export const metadata = {
  event: 'payment_gateways.payment.captured',
  persistent: true,
  id: 'marketing_automation:payment-captured',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await forwardEventToCampaigns('payment_gateways.payment.captured', payload, ctx)
}
