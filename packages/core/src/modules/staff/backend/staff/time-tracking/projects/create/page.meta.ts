export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.projects.manage'],
  navHidden: true,
  pageTitle: 'Create Project',
  pageTitleKey: 'staff.timesheets.nav.create_project',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Projects', labelKey: 'staff.time_tracking.nav.projects', href: '/backend/staff/time-tracking/projects' },
    { label: 'Create', labelKey: 'staff.timesheets.nav.create_project' },
  ],
}
