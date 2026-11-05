export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.manage'],
  navHidden: true,
  pageTitle: 'Edit Schedule',
  pageTitleKey: 'scheduler.edit.title',
  breadcrumb: [
    { label: 'Scheduled Jobs', labelKey: 'scheduler.title', href: '/backend/config/scheduled-jobs' },
    { label: 'Edit Schedule', labelKey: 'scheduler.edit.title' },
  ],
}
