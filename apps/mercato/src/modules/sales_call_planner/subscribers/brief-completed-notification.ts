import { BRIEF_COMPLETED_EVENT_ID } from '../events'
import {
  deliverBriefNotification,
  normalizeTaskCount,
  type BriefNotificationResolverContext,
} from '../lib/brief-notifications'

/**
 * `persistent: true` states the intent the platform's own table assigns to a
 * notification, and matches `workflows:task-assigned-notification`. Be clear
 * about what it buys HERE, though: `executeEmitEvent` emits without the
 * `persistent` option, so this event is never enqueued and the handler runs
 * inline in the transition activity with no retry of its own. The flag costs
 * nothing (a non-persistent emit still delivers persistent subscribers inline)
 * and becomes real the day this event is emitted persistently — at which point
 * the queue's retry needs the handler to be idempotent, which it is: the stable
 * `groupKey` makes a second delivery refresh one row instead of adding another.
 */
export const metadata = {
  event: BRIEF_COMPLETED_EVENT_ID,
  persistent: true,
  id: 'sales-call-planner:brief-completed-notification',
}

export default async function handle(payload: unknown, ctx: BriefNotificationResolverContext) {
  const taskCount = normalizeTaskCount((payload as { taskCount?: unknown } | null)?.taskCount)

  await deliverBriefNotification({
    ctx,
    payload,
    notificationType: BRIEF_COMPLETED_EVENT_ID,
    extraBodyVariables: { count: String(taskCount) },
    component: 'brief-completed-notification',
  })
}
