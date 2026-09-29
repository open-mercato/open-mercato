export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.reports.manage'],
  pageTitle: 'New report',
  pageTitleKey: 'staff.time_tracking.reports.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Reports', labelKey: 'staff.time_tracking.nav.reports', href: '/backend/staff/time-tracking/reports' },
    { label: 'New report', labelKey: 'staff.time_tracking.reports.create.title' },
  ],
}
