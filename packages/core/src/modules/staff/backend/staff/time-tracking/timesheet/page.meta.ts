export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.view'],
  pageTitle: 'Timesheet',
  pageTitleKey: 'staff.time_tracking.nav.timesheet',
  pageGroup: 'Time tracking',
  pageGroupKey: 'staff.time_tracking.nav.group',
  pageOrder: 50,
  icon: 'calendar',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Timesheet', labelKey: 'staff.time_tracking.nav.timesheet' },
  ],
}
