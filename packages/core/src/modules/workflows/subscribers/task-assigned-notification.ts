import { notificationTypes } from '../notifications'
import {
  notifyTaskLifecycleEvent,
  type TaskLifecycleNotificationPayload,
  type TaskNotificationResolverContext,
} from '../lib/task-notifications'
import {
  buildTaskQuickActions,
  resolveTaskPrimaryActionId,
  type TaskQuickActionInput,
} from '../lib/task-quick-action'

export const metadata = {
  event: 'workflows.task.assigned',
  persistent: true,
  id: 'workflows:task-assigned-notification',
}

type TaskAssignedPayload = TaskLifecycleNotificationPayload & {
  /**
   * Present only when the emitter knows the task's decision/form shape. Absent
   * means unknown, and the notification falls back to the deep link — a quick
   * action is never offered on a guess.
   */
  quickAction?: TaskQuickActionInput | null
}

export default async function handle(
  payload: TaskAssignedPayload,
  ctx: TaskNotificationResolverContext
) {
  const quickAction = payload?.quickAction ?? null

  await notifyTaskLifecycleEvent({
    ctx,
    notificationTypes,
    notificationType: 'workflows.task.assigned',
    payload,
    ...(quickAction
      ? {
          actions: buildTaskQuickActions(quickAction),
          primaryActionId: resolveTaskPrimaryActionId(quickAction),
        }
      : {}),
    component: 'task-assigned-notification',
  })
}
