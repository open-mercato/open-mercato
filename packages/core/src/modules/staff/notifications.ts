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
  {
    // Spec D-6: the "Request access" button on screens 2 and 17 raises a real
    // notification for every `staff.timesheets.projects.manage` holder. The
    // subscriber overrides `linkHref` with the requester-specific deep link so
    // the project team drawer opens with the requester pre-selected.
    type: 'staff.timesheets.project_access.requested',
    module: 'staff',
    titleKey: 'staff.notifications.timeProjectAccess.requested.title',
    bodyKey: 'staff.notifications.timeProjectAccess.requested.body',
    icon: 'user-plus',
    severity: 'info',
    actions: [
      {
        id: 'open-team',
        labelKey: 'staff.notifications.timeProjectAccess.actions.openTeam',
        variant: 'default',
        icon: 'users',
        href: '/backend/staff/time-tracking/projects/{sourceEntityId}?panel=team',
      },
    ],
    primaryActionId: 'open-team',
    linkHref: '/backend/staff/time-tracking/projects',
    expiresAfterHours: 168, // 7 days
  },
  {
    // Screen 4 budget card: "Ostrzezenie przy 80% i 100% wykorzystania". One type
    // covers both thresholds — the subscriber raises the severity to `error` for the
    // 100% crossing and carries the numbers in `bodyVariables`, so the two alerts
    // read differently without splitting the notification id.
    type: 'staff.timesheets.time_project.budget_threshold_reached',
    module: 'staff',
    titleKey: 'staff.notifications.timeProjectBudget.thresholdReached.title',
    bodyKey: 'staff.notifications.timeProjectBudget.thresholdReached.body',
    icon: 'gauge',
    severity: 'warning',
    actions: [
      {
        id: 'open-project',
        labelKey: 'staff.notifications.timeProjectBudget.actions.openProject',
        variant: 'default',
        icon: 'external-link',
        href: '/backend/staff/time-tracking/projects/{sourceEntityId}',
      },
    ],
    primaryActionId: 'open-project',
    linkHref: '/backend/staff/time-tracking/projects/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
]

export default notificationTypes
