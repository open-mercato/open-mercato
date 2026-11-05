export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_sync.view'],
  pageTitle: 'Sync Run Detail',
  pageTitleKey: 'data_sync.runs.detail.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Data Sync', labelKey: 'data_sync.nav.title', href: '/backend/data-sync' },
  ],
}
