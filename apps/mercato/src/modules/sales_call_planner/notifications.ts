import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { BRIEF_COMPLETED_EVENT_ID, BRIEF_FAILED_EVENT_ID } from './events'

/**
 * The two in-app notification types this module produces.
 *
 * The type ids deliberately match the event ids that produce them: one fact,
 * one notification, and an operator reading a notification row can find the
 * event that made it without a lookup table.
 *
 * `actions` is empty here and the "open the company" action is built per
 * notification in `lib/brief-notifications.ts`. A type definition's action
 * `href` is static, and the company link carries the company id — the same
 * reason `workflows/lib/task-notifications.ts` overrides its type definition's
 * actions per delivery.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: BRIEF_COMPLETED_EVENT_ID,
    module: 'sales_call_planner',
    titleKey: 'sales_call_planner.notifications.briefCompleted.title',
    bodyKey: 'sales_call_planner.notifications.briefCompleted.body',
    icon: 'phone-call',
    severity: 'success',
    actions: [],
    expiresAfterHours: 168,
  },
  {
    type: BRIEF_FAILED_EVENT_ID,
    module: 'sales_call_planner',
    titleKey: 'sales_call_planner.notifications.briefFailed.title',
    bodyKey: 'sales_call_planner.notifications.briefFailed.body',
    icon: 'phone-off',
    severity: 'error',
    actions: [],
    expiresAfterHours: 168,
  },
]

export default notificationTypes
