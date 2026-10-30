import { convertReferralFromOrderEvent } from '../lib/referral-events.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

/**
 * Converts a pending referral when the referred customer's order is placed AFTER it was created — a draft,
 * a quote turned into an order, or a submission confirmed later. `sales.order.created` fires once, at
 * creation, and never again; an order that was not yet placed at that moment left its referral `pending`
 * forever, because nothing asked the eligibility question a second time once the order actually became
 * one. `sales.order.confirmed` is the event this module already trusts for that "now it counts" moment —
 * `subscribers/sales-order-confirmed.ts` forwards it to campaign triggers for the same reason.
 *
 * See `lib/referral-events.ts` for why `sales.order.updated` is not used instead: the update command does
 * not currently put that event on the bus at all.
 */
export const metadata = {
  event: 'sales.order.confirmed',
  persistent: true,
  id: 'marketing_automation:referral-conversion-on-confirm',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await convertReferralFromOrderEvent('sales.order.confirmed', payload, ctx)
}
