export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.projects.manage'],
  navHidden: true,
  pageTitle: 'Create Project',
  pageTitleKey: 'staff.timesheets.nav.create_project',
  breadcrumb: [
    { label: 'My Timesheets', labelKey: 'staff.timesheets.nav.my_timesheets', href: '/backend/staff/timesheets' },
    { label: 'Projects', labelKey: 'staff.timesheets.nav.projects', href: '/backend/staff/timesheets/projects' },
    { label: 'Create', labelKey: 'staff.timesheets.nav.create_project' },
  ],
}
