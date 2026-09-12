export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.projects.view'],
  navHidden: false,
  pageTitle: 'Projects',
  pageTitleKey: 'staff.time_tracking.nav.projects',
  pageGroup: 'Time tracking',
  pageGroupKey: 'staff.time_tracking.nav.group',
  pageOrder: 20,
  icon: 'folder-tree',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Projects', labelKey: 'staff.time_tracking.nav.projects' },
  ],
}
