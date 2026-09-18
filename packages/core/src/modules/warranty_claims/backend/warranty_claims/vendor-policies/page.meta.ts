export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.vendor_policy.manage'],
  pageTitle: 'Vendor policies',
  pageTitleKey: 'warranty_claims.vendorPolicies.nav.title',
  pageGroup: 'Warranty claims',
  pageGroupKey: 'warranty_claims.nav.group',
  pagePriority: 40,
  pageOrder: 300,
  icon: 'truck',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Vendor policies', labelKey: 'warranty_claims.vendorPolicies.nav.title' },
  ],
}

export default metadata
