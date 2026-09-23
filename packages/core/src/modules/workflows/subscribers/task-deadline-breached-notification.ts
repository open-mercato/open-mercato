import { notificationTypes } from '../notifications'
import {
  notifyTaskLifecycleEvent,
  type TaskLifecycleNotificationPayload,
  type TaskNotificationResolverContext,
} from '../lib/task-notifications'

/**
 * The breach notification is emitted for every breach, whatever the step's
 * `onBreach` action turns out to be: someone always needs to know the deadline
 * passed, even when the run has already been routed away from the task.
 */
export const metadata = {
  event: 'workflows.task.deadline_breached',
  persistent: true,
  id: 'workflows:task-deadline-breached-notification',
}

export default async function handle(
  payload: TaskLifecycleNotificationPayload,
  ctx: TaskNotificationResolverContext
) {
  await notifyTaskLifecycleEvent({
    ctx,
    notificationTypes,
    notificationType: 'workflows.task.deadline_breached',
    payload,
    groupByType: true,
    component: 'task-deadline-breached-notification',
  })
}
