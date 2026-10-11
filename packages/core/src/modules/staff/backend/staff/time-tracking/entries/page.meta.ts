export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.view'],
  pageTitle: 'Time entries',
  pageTitleKey: 'staff.time_tracking.nav.entries',
  pageGroup: 'Time tracking',
  pageGroupKey: 'staff.time_tracking.nav.group',
  pageOrder: 40,
  icon: 'list',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Time entries', labelKey: 'staff.time_tracking.nav.entries' },
  ],
}
