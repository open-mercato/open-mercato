export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.tasks.view'],
  pageTitle: 'Tasks',
  pageTitleKey: 'staff.time_tracking.nav.tasks',
  pageGroup: 'Time tracking',
  pageGroupKey: 'staff.time_tracking.nav.group',
  pageOrder: 30,
  icon: 'layers',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Tasks', labelKey: 'staff.time_tracking.nav.tasks' },
  ],
}
