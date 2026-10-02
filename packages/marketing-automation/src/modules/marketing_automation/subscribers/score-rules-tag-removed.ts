import { rescoreSubjectFromEvent } from '../lib/score-rule-events.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

export const metadata = {
  event: 'customers.tag.removed',
  persistent: true,
  id: 'marketing_automation:score-rules-tag-removed',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await rescoreSubjectFromEvent('customers.tag.removed', payload, ctx)
}
