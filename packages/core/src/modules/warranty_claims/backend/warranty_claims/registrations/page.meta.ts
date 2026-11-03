export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.registration.view'],
  pageTitle: 'Registrations',
  pageTitleKey: 'warranty_claims.registrations.nav.title',
  pageGroup: 'Warranty claims',
  pageGroupKey: 'warranty_claims.nav.group',
  pagePriority: 40,
  pageOrder: 200,
  icon: 'badge-check',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Registrations', labelKey: 'warranty_claims.registrations.nav.title' },
  ],
}
