export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.claim.manage'],
  pageTitle: 'Edit claim',
  pageTitleKey: 'warranty_claims.edit.title',
  pageGroup: 'Warranty claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Edit claim', labelKey: 'warranty_claims.edit.title' },
  ],
}
