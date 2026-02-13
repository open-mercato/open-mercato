export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.view'],
  navHidden: true,
  pageTitle: 'Schedule Details',
  pageTitleKey: 'scheduler.details.title',
  breadcrumb: [
    { label: 'Scheduled Jobs', labelKey: 'scheduler.title', href: '/backend/config/scheduled-jobs' },
    { label: 'Schedule Details', labelKey: 'scheduler.details.title' },
  ],
}
