import { forwardEventToCampaigns } from '../lib/subscriber-forward.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

/**
 * The module's own score change, forwarded to campaigns like any platform event.
 *
 * Without this subscriber the trigger was offered in the palette, accepted by the save and never
 * fired — the failure mode this module's own guidance calls the worst one it has. The event is emitted
 * by `add_points`, so the save-time cycle check is what stops a campaign driving itself through it.
 */
export const metadata = {
  event: 'marketing_automation.score.changed',
  persistent: true,
  id: 'marketing_automation:score-changed',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await forwardEventToCampaigns('marketing_automation.score.changed', payload, ctx)
}
