import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'staff.leave_request.pending',
    // Ships without push — operators re-enable it per type from the Notification Delivery settings.
    channels: ['in_app', 'email'],
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
    // Ships without push — operators re-enable it per type from the Notification Delivery settings.
    channels: ['in_app', 'email'],
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
    // Ships without push — operators re-enable it per type from the Notification Delivery settings.
    channels: ['in_app', 'email'],
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
    channels: ['in_app', 'email'],
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
    channels: ['in_app', 'email'],
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
  {
    /**
     * EP-48. Raised by `subscribers/time-report-approved-notification.ts` when a
     * report is closed — closing IS the approval in this module: it freezes every
     * per-entry value and locks the entries, and `staff.timesheets.lock` is the
     * feature that gates it. The recipient is the person who drafted the report,
     * who otherwise learns about it only by reopening the screen.
     */
    type: 'staff.timesheets.time_report.approved',
    channels: ['in_app', 'email'],
    module: 'staff',
    titleKey: 'staff.notifications.timeReport.approved.title',
    bodyKey: 'staff.notifications.timeReport.approved.body',
    icon: 'file-check',
    severity: 'success',
    actions: [
      {
        id: 'open-report',
        labelKey: 'staff.notifications.timeReport.actions.openReport',
        variant: 'default',
        icon: 'external-link',
        href: '/backend/staff/time-tracking/reports/{sourceEntityId}',
      },
    ],
    primaryActionId: 'open-report',
    linkHref: '/backend/staff/time-tracking/reports/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
  {
    /**
     * EP-48, contributable-only by design. The module has exactly one report
     * transition — draft → closed — so there is no "submitted, awaiting a second
     * pair of eyes" state for core to announce. This id exists so the multi-step
     * approval a `registerReportApprovalPolicy` contribution (EP-41) implements
     * has a published notification to raise instead of inventing its own, and so
     * the renderer and delivery preferences are already in place when it does.
     */
    type: 'staff.timesheets.time_report.ready_for_approval',
    channels: ['in_app', 'email'],
    module: 'staff',
    titleKey: 'staff.notifications.timeReport.readyForApproval.title',
    bodyKey: 'staff.notifications.timeReport.readyForApproval.body',
    icon: 'file-clock',
    severity: 'info',
    actions: [
      {
        id: 'review-report',
        labelKey: 'staff.notifications.timeReport.actions.reviewReport',
        variant: 'default',
        icon: 'external-link',
        href: '/backend/staff/time-tracking/reports/{sourceEntityId}',
      },
    ],
    primaryActionId: 'review-report',
    linkHref: '/backend/staff/time-tracking/reports/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
  {
    /**
     * EP-48, contributable-only by design. "This timer has been running for six
     * hours" needs something that wakes up on a schedule and looks at open
     * timers; the module ships no periodic job and inventing one to justify an id
     * would be the tail wagging the dog. The id is the contract for a module that
     * does ship one.
     */
    type: 'staff.timesheets.time_entry.timer_running_long',
    channels: ['in_app'],
    module: 'staff',
    titleKey: 'staff.notifications.timeEntryTimer.runningLong.title',
    bodyKey: 'staff.notifications.timeEntryTimer.runningLong.body',
    icon: 'timer',
    severity: 'warning',
    actions: [
      {
        id: 'open-timesheet',
        labelKey: 'staff.notifications.timesheet.actions.openTimesheet',
        variant: 'default',
        icon: 'external-link',
        href: '/backend/staff/time-tracking/timesheet',
      },
    ],
    primaryActionId: 'open-timesheet',
    linkHref: '/backend/staff/time-tracking/timesheet',
    expiresAfterHours: 24,
  },
  {
    /**
     * EP-48, contributable-only by design. Whether a period is "incomplete" is
     * the capacity provider's question (EP-40), and the built-in provider spreads
     * one flat daily number over the caller's working days on demand — it has no
     * schedule and no opinion about when to complain. A contributed provider that
     * knows contract hours and leave is the thing that can raise this honestly.
     */
    type: 'staff.timesheets.timesheet.period_incomplete',
    channels: ['in_app', 'email'],
    module: 'staff',
    titleKey: 'staff.notifications.timesheet.periodIncomplete.title',
    bodyKey: 'staff.notifications.timesheet.periodIncomplete.body',
    icon: 'calendar-clock',
    severity: 'warning',
    actions: [
      {
        id: 'open-timesheet',
        labelKey: 'staff.notifications.timesheet.actions.openTimesheet',
        variant: 'default',
        icon: 'external-link',
        href: '/backend/staff/time-tracking/timesheet',
      },
    ],
    primaryActionId: 'open-timesheet',
    linkHref: '/backend/staff/time-tracking/timesheet',
    expiresAfterHours: 168, // 7 days
  },
]

export default notificationTypes
