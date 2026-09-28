import { forwardEventToCampaigns } from './shared.js'
import type { SubscriberContext } from './shared.js'

/**
 * An inbound hook, forwarded to campaigns like any other event.
 *
 * The endpoint emits and returns; everything that decides whether a run starts — the audience, the
 * re-entry policy, the per-subject budget, the duplicate guard keyed on the delivered payload — lives on
 * this path already. A hook that enrolled directly would be a second dispatcher to keep in step.
 */
export const metadata = {
  event: 'marketing_automation.inbound.received',
  persistent: true,
  id: 'marketing_automation:inbound-received',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await forwardEventToCampaigns('marketing_automation.inbound.received', payload, ctx)
}
