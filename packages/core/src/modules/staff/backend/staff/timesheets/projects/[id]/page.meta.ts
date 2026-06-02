export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.projects.view'],
  navHidden: true,
  pageTitle: 'Project Details',
  pageTitleKey: 'staff.timesheets.nav.project_details',
  breadcrumb: [
    { label: 'My Timesheets', labelKey: 'staff.timesheets.nav.my_timesheets', href: '/backend/staff/timesheets' },
    { label: 'Projects', labelKey: 'staff.timesheets.nav.projects', href: '/backend/staff/timesheets/projects' },
    { label: 'Details', labelKey: 'staff.timesheets.nav.project_details' },
  ],
}
