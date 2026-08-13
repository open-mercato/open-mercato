import { BRIEF_FAILED_EVENT_ID } from '../events'
import {
  classifyFailureCause,
  deliverBriefNotification,
  type BriefNotificationResolverContext,
} from '../lib/brief-notifications'

/**
 * `persistent: true` for the same reason as the completed subscriber — see the
 * note there for what the flag does and does not buy on the EMIT_EVENT path.
 */
export const metadata = {
  event: BRIEF_FAILED_EVENT_ID,
  persistent: true,
  id: 'sales-call-planner:brief-failed-notification',
}

export default async function handle(payload: unknown, ctx: BriefNotificationResolverContext) {
  /**
   * Classified here rather than trusted: the workflow definition that emits
   * this event is authored JSON, so `cause` could just as easily arrive holding
   * an interpolated raw error message. Coercing to the closed vocabulary is
   * what keeps free text out of the notification row.
   */
  const cause = classifyFailureCause((payload as { cause?: unknown } | null)?.cause)

  await deliverBriefNotification({
    ctx,
    payload,
    notificationType: BRIEF_FAILED_EVENT_ID,
    extraBodyVariables: { cause },
    component: 'brief-failed-notification',
  })
}
