export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.projects.view'],
  navHidden: true,
  pageTitle: 'Project Details',
  pageTitleKey: 'staff.timesheets.nav.project_details',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Projects', labelKey: 'staff.time_tracking.nav.projects', href: '/backend/staff/time-tracking/projects' },
    { label: 'Details', labelKey: 'staff.timesheets.nav.project_details' },
  ],
}
