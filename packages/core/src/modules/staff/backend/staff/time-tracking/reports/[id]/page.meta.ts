export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.reports.view'],
  navHidden: true,
  pageTitle: 'Report',
  pageTitleKey: 'staff.time_tracking.reports.detail.title',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Reports', labelKey: 'staff.time_tracking.nav.reports', href: '/backend/staff/time-tracking/reports' },
    { label: 'Report', labelKey: 'staff.time_tracking.reports.detail.title' },
  ],
}
