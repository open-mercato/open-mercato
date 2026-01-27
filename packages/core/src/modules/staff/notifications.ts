import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'staff.leave_request.pending',
    module: 'staff',
    titleKey: 'staff.notifications.leaveRequest.pending.title',
    bodyKey: 'staff.notifications.leaveRequest.pending.body',
    icon: 'calendar-off',
    severity: 'warning',
    actions: [
      {
        id: 'approve',
        labelKey: 'staff.notifications.leaveRequest.actions.approve',
        variant: 'default',
        icon: 'check',
        commandId: 'staff.leave-requests.accept',
      },
      {
        id: 'reject',
        labelKey: 'staff.notifications.leaveRequest.actions.reject',
        variant: 'destructive',
        icon: 'x',
        commandId: 'staff.leave-requests.reject',
      },
    ],
    primaryActionId: 'approve',
    linkHref: '/backend/staff/leave-requests/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
