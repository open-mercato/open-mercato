import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

const taskDeepLink = '/backend/tasks/{sourceEntityId}'

const viewTaskAction = {
  id: 'view',
  labelKey: 'common.view',
  variant: 'outline' as const,
  href: taskDeepLink,
  icon: 'external-link',
}

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'workflows.task.assigned',
    // Ships without push — operators re-enable it per type from the Notification Delivery settings.
    channels: ['in_app', 'email'],
    module: 'workflows',
    titleKey: 'workflows.notifications.task.assigned.title',
    bodyKey: 'workflows.notifications.task.assigned.body',
    icon: 'clipboard-list',
    severity: 'info',
    actions: [viewTaskAction],
    linkHref: taskDeepLink,
    expiresAfterHours: 168, // 7 days
  },
  {
    type: 'workflows.task.reminder_due',
    // Same delivery as `workflows.task.assigned`: an SLA reminder or breach is
    // about the task the operator already gets assignment mail for.
    channels: ['in_app', 'email'],
    module: 'workflows',
    titleKey: 'workflows.notifications.task.reminderDue.title',
    bodyKey: 'workflows.notifications.task.reminderDue.body',
    icon: 'alarm-clock',
    severity: 'warning',
    actions: [viewTaskAction],
    linkHref: taskDeepLink,
    expiresAfterHours: 168,
  },
  {
    type: 'workflows.task.deadline_breached',
    // Same delivery as `workflows.task.assigned`: an SLA reminder or breach is
    // about the task the operator already gets assignment mail for.
    channels: ['in_app', 'email'],
    module: 'workflows',
    titleKey: 'workflows.notifications.task.deadlineBreached.title',
    bodyKey: 'workflows.notifications.task.deadlineBreached.body',
    icon: 'alert-triangle',
    severity: 'error',
    actions: [viewTaskAction],
    linkHref: taskDeepLink,
    expiresAfterHours: 168,
  },
]

export default notificationTypes
