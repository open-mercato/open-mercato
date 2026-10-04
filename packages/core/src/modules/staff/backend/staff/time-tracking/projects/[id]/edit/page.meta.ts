export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.projects.manage'],
  navHidden: true,
  pageTitle: 'Edit Project',
  pageTitleKey: 'staff.timesheets.nav.edit_project',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Projects', labelKey: 'staff.time_tracking.nav.projects', href: '/backend/staff/time-tracking/projects' },
    { label: 'Edit', labelKey: 'staff.timesheets.nav.edit_project' },
  ],
}
