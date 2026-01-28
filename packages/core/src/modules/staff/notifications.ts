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
  {
    type: 'staff.leave_request.approved',
    module: 'staff',
    titleKey: 'staff.notifications.leaveRequest.approved.title',
    bodyKey: 'staff.notifications.leaveRequest.approved.body',
    icon: 'calendar-check',
    severity: 'success',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/staff/leave-requests/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/staff/leave-requests/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
  {
    type: 'staff.leave_request.rejected',
    module: 'staff',
    titleKey: 'staff.notifications.leaveRequest.rejected.title',
    bodyKey: 'staff.notifications.leaveRequest.rejected.body',
    icon: 'calendar-x',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/staff/leave-requests/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/staff/leave-requests/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
]

export default notificationTypes
