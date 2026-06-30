export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_quality.scan.view'],
  pageTitle: 'Scan Runs',
  pageTitleKey: 'data_quality.scans.title',
  breadcrumb: [
    { label: 'Data Quality', labelKey: 'data_quality.nav.title', href: '/backend/data-quality' },
    { label: 'Scans', labelKey: 'data_quality.nav.scans' },
  ],
}
