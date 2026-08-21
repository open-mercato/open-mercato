export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.registration.manage'],
  pageTitle: 'Edit registration',
  pageTitleKey: 'warranty_claims.registrations.edit.title',
  pageGroup: 'Warranty claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Registrations', labelKey: 'warranty_claims.registrations.nav.title', href: '/backend/warranty_claims/registrations' },
    { label: 'Edit registration', labelKey: 'warranty_claims.registrations.edit.title' },
  ],
}
