export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.claim.create'],
  pageTitle: 'New claim',
  pageTitleKey: 'warranty_claims.create.title',
  pageGroup: 'Warranty claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'New claim', labelKey: 'warranty_claims.create.title' },
  ],
}
