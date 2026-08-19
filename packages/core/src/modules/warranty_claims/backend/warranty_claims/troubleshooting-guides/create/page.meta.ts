export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.troubleshooting.manage'],
  pageTitle: 'New troubleshooting guide',
  pageTitleKey: 'warranty_claims.troubleshootingGuides.create.title',
  pageGroup: 'Warranty claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Troubleshooting guides', labelKey: 'warranty_claims.troubleshootingGuides.nav.title', href: '/backend/warranty_claims/troubleshooting-guides' },
    { label: 'New troubleshooting guide', labelKey: 'warranty_claims.troubleshootingGuides.create.title' },
  ],
}

export default metadata
