import { convertReferralFromOrderEvent } from '../lib/referral-events.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

/**
 * Turns a pending referral into a converted one when the referred customer's order is already placed the
 * moment it is created — the common storefront shape. See `lib/referral-events.ts` for the shape this one
 * event alone cannot cover, and why `sales-order-confirmed-referral-conversion.ts` exists beside it.
 *
 * A second subscriber on `sales.order.created` rather than logic inside the first: forwarding an event to
 * campaigns and converting a referral are unrelated jobs with different failure modes, and a referral write
 * that threw would otherwise stop every campaign from seeing the order.
 *
 * Runs on EVERY order in the installation, so the first thing it does is the cheapest question it can ask —
 * does this customer have a pending claim — and the overwhelmingly common answer is no.
 */
export const metadata = {
  event: 'sales.order.created',
  persistent: true,
  id: 'marketing_automation:referral-conversion',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await convertReferralFromOrderEvent('sales.order.created', payload, ctx)
}
