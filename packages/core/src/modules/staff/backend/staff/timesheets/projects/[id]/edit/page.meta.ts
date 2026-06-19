export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.projects.manage'],
  navHidden: true,
  pageTitle: 'Edit Project',
  pageTitleKey: 'staff.timesheets.nav.edit_project',
  breadcrumb: [
    { label: 'My Timesheets', labelKey: 'staff.timesheets.nav.my_timesheets', href: '/backend/staff/timesheets' },
    { label: 'Projects', labelKey: 'staff.timesheets.nav.projects', href: '/backend/staff/timesheets/projects' },
    { label: 'Edit', labelKey: 'staff.timesheets.nav.edit_project' },
  ],
}
