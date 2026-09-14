import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'

/**
 * EP-48. Reactive browser handlers for the time-tracking notification types.
 *
 * A handler is the module's own reaction to one of its notifications arriving in
 * the browser: it re-broadcasts on the DOM Event Bridge so an open screen can
 * refetch, and toasts the ones a person needs to see even when the bell is
 * collapsed. Each `id` is the override key — `notifications.handlers.<id>` — so
 * an app can disable or replace one without patching this file.
 *
 * `features` is checked with the wildcard-aware policy before `handle` runs, so
 * a handler never fires for a caller who could not open the screen it points at.
 */

export const TIME_REPORT_APPROVED_EVENT = 'om:staff:time-report-approved'
export const TIME_REPORT_READY_FOR_APPROVAL_EVENT = 'om:staff:time-report-ready-for-approval'
export const TIMER_RUNNING_LONG_EVENT = 'om:staff:timer-running-long'
export const TIMESHEET_PERIOD_INCOMPLETE_EVENT = 'om:staff:timesheet-period-incomplete'

export const notificationHandlers: NotificationHandler[] = [
  {
    id: 'staff.time-report-approved-event',
    notificationType: 'staff.timesheets.time_report.approved',
    features: ['staff.timesheets.reports.view'],
    priority: 100,
    handle(notification, context) {
      context.emitEvent(TIME_REPORT_APPROVED_EVENT, {
        notificationId: notification.id,
        reportId: notification.sourceEntityId ?? null,
        reference: notification.bodyVariables?.reference ?? null,
      })
      context.refreshNotifications()
    },
  },
  {
    id: 'staff.time-report-ready-for-approval-event',
    notificationType: 'staff.timesheets.time_report.ready_for_approval',
    features: ['staff.timesheets.reports.view'],
    priority: 100,
    handle(notification, context) {
      context.emitEvent(TIME_REPORT_READY_FOR_APPROVAL_EVENT, {
        notificationId: notification.id,
        reportId: notification.sourceEntityId ?? null,
        reference: notification.bodyVariables?.reference ?? null,
      })
    },
  },
  {
    /**
     * A running timer keeps billing until somebody stops it, so this one toasts
     * as well as broadcasting — the bell alone is too quiet for a notification
     * whose whole point is that the person has forgotten something.
     */
    id: 'staff.timer-running-long-toast',
    notificationType: 'staff.timesheets.time_entry.timer_running_long',
    features: ['staff.timesheets.view'],
    priority: 110,
    debounceMs: 60_000,
    handle(notification, context) {
      context.toast({
        title: notification.title,
        body: notification.body ?? undefined,
        severity: 'warning',
      })
      context.emitEvent(TIMER_RUNNING_LONG_EVENT, {
        notificationId: notification.id,
        timeEntryId: notification.sourceEntityId ?? null,
      })
    },
  },
  {
    id: 'staff.timesheet-period-incomplete-event',
    notificationType: 'staff.timesheets.timesheet.period_incomplete',
    features: ['staff.timesheets.view'],
    priority: 90,
    handle(notification, context) {
      context.emitEvent(TIMESHEET_PERIOD_INCOMPLETE_EVENT, {
        notificationId: notification.id,
        staffMemberId: notification.sourceEntityId ?? null,
        periodFrom: notification.bodyVariables?.periodFrom ?? null,
        periodTo: notification.bodyVariables?.periodTo ?? null,
      })
    },
  },
]

export default notificationHandlers
