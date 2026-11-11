import { rescoreSubjectFromEvent } from '../lib/score-rule-events.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

export const metadata = {
  event: 'customers.person.updated',
  persistent: true,
  id: 'marketing_automation:score-rules-person-updated',
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  await rescoreSubjectFromEvent('customers.person.updated', payload, ctx)
}
