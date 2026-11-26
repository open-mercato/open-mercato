import { convertReferralFromOrderEvent } from '../lib/referral-events.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

/**
 * Converts a pending referral when an order becomes placed through a plain update, with no status
 * transition for `sales.order.confirmed` to fire on.
 *
 * An order created already `confirmed` but not yet `placedAt` (a backoffice order awaiting fulfilment, for
 * one) fires `sales.order.confirmed` once, at creation — `emitOrderLifecycleEventsForTransition` runs
 * unconditionally on create — but with `placedAt` still null, `convertReferralFromOrderEvent` finds nothing
 * eligible yet. If `placedAt` is set afterwards by itself, with `status` unchanged, the transition guard in
 * `emitOrderLifecycleEventsForTransition` (`previousStatus === nextStatus`) means `.confirmed` never fires
 * again either. Nothing ever asked the eligibility question a second time, and the referral stayed
 * `pending` forever — see `lib/referral-events.ts` for the full shape this subscriber closes.
 *
 * `sales.order.updated` only reaches the bus because the update command now passes `events:
 * orderCrudEvents` to `emitCrudSideEffects` (`packages/core/src/modules/sales/commands/documents.ts`) — it
 * previously did not, which is why this subscriber did not exist until now.
 */
export const metadata = {
  event: 'sales.order.updated',
  persistent: true,
  id: 'marketing_automation:referral-conversion-on-update',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await convertReferralFromOrderEvent('sales.order.updated', payload, ctx)
}
