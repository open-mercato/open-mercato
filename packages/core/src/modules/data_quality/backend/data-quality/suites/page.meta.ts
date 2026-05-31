export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_quality.suite.view'],
  pageTitle: 'Data Quality Suites',
  pageTitleKey: 'data_quality.suites.title',
  breadcrumb: [
    { label: 'Data Quality', labelKey: 'data_quality.nav.title', href: '/backend/data-quality' },
    { label: 'Suites', labelKey: 'data_quality.nav.suites' },
  ],
}
