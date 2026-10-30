import { rescoreSubjectFromEvent } from '../lib/score-rule-events.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

export const metadata = {
  event: 'customers.tag.assigned',
  persistent: true,
  id: 'marketing_automation:score-rules-tag-assigned',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await rescoreSubjectFromEvent('customers.tag.assigned', payload, ctx)
}
