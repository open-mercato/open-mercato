export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.settings.manage'],
  pageTitle: 'Warranty claim settings',
  pageTitleKey: 'warranty_claims.settings.pageTitle',
  pageGroup: 'Warranty claims',
  pageGroupKey: 'warranty_claims.nav.group',
  pagePriority: 40,
  pageOrder: 900,
  icon: 'settings',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Warranty claim settings', labelKey: 'warranty_claims.settings.pageTitle' },
  ],
}
