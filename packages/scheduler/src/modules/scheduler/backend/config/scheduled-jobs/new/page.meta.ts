export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.job.manage'],
  navHidden: true,
  pageTitle: 'Create Schedule',
  pageTitleKey: 'scheduler.create.title',
  breadcrumb: [
    { label: 'Scheduled Jobs', labelKey: 'scheduler.title', href: '/backend/config/scheduled-jobs' },
    { label: 'Create Schedule', labelKey: 'scheduler.create.title' },
  ],
}
