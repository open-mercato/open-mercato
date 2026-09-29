export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.claim.view'],
  pageTitle: 'Claim detail',
  pageTitleKey: 'warranty_claims.detail.title',
  pageGroup: 'Warranty claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Claim detail', labelKey: 'warranty_claims.detail.title' },
  ],
}
