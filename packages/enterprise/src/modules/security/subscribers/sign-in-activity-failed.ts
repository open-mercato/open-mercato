import type { SubscriberContext } from '@open-mercato/events/types'
import { recordSignInEvent } from '../lib/record-sign-in-event'

export const metadata = {
  event: 'auth.login.failed',
  persistent: true,
  id: 'security:sign-in-activity-failed',
}

export default async function subscribe(payload: unknown, context: SubscriberContext) {
  await recordSignInEvent('failure', payload, context)
}
