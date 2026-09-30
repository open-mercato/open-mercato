export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.tasks.view'],
  navHidden: true,
  pageTitle: 'Tasks',
  pageTitleKey: 'staff.time_tracking.nav.tasks',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Projects', labelKey: 'staff.time_tracking.nav.projects', href: '/backend/staff/time-tracking/projects' },
    { label: 'Tasks', labelKey: 'staff.time_tracking.nav.tasks' },
  ],
}
