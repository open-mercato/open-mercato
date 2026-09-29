import { notificationTypes } from '../notifications'
import {
  notifyTaskLifecycleEvent,
  type TaskLifecycleNotificationPayload,
  type TaskNotificationResolverContext,
} from '../lib/task-notifications'

/**
 * A reminder reaches exactly the audience the assignment reached — the named
 * assignee, or every member of the authored role queue — because both route
 * through the same recipient resolution.
 */
export const metadata = {
  event: 'workflows.task.reminder_due',
  persistent: true,
  id: 'workflows:task-reminder-notification',
}

export default async function handle(
  payload: TaskLifecycleNotificationPayload,
  ctx: TaskNotificationResolverContext
) {
  await notifyTaskLifecycleEvent({
    ctx,
    notificationTypes,
    notificationType: 'workflows.task.reminder_due',
    payload,
    groupByType: true,
    component: 'task-reminder-notification',
  })
}
