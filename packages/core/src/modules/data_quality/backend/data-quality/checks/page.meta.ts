export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_quality.check.view'],
  pageTitle: 'Data Quality Checks',
  pageTitleKey: 'data_quality.checks.title',
  breadcrumb: [
    { label: 'Data Quality', labelKey: 'data_quality.nav.title', href: '/backend/data-quality' },
    { label: 'Checks', labelKey: 'data_quality.nav.checks' },
  ],
}
