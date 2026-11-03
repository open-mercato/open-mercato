export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.vendor_policy.manage'],
  pageTitle: 'New vendor policy',
  pageTitleKey: 'warranty_claims.vendorPolicies.create.title',
  pageGroup: 'Warranty claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Vendor policies', labelKey: 'warranty_claims.vendorPolicies.nav.title', href: '/backend/warranty_claims/vendor-policies' },
    { label: 'New vendor policy', labelKey: 'warranty_claims.vendorPolicies.create.title' },
  ],
}

export default metadata
