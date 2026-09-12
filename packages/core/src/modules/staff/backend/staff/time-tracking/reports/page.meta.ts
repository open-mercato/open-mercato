export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.reports.view'],
  pageTitle: 'Reports',
  pageTitleKey: 'staff.time_tracking.nav.reports',
  pageGroup: 'Time tracking',
  pageGroupKey: 'staff.time_tracking.nav.group',
  pageOrder: 60,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Reports', labelKey: 'staff.time_tracking.nav.reports' },
  ],
}
