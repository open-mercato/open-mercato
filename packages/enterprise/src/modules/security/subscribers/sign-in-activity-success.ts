import type { SubscriberContext } from '@open-mercato/events/types'
import { recordSignInEvent } from '../lib/record-sign-in-event'

export const metadata = {
  event: 'auth.login.success',
  persistent: true,
  id: 'security:sign-in-activity-success',
}

export default async function subscribe(payload: unknown, context: SubscriberContext) {
  await recordSignInEvent('success', payload, context)
}
