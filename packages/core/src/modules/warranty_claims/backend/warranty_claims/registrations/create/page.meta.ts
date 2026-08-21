export const metadata = {
  requireAuth: true,
  requireFeatures: ['warranty_claims.registration.manage'],
  pageTitle: 'New registration',
  pageTitleKey: 'warranty_claims.registrations.create.title',
  pageGroup: 'Warranty claims',
  pageGroupKey: 'warranty_claims.nav.group',
  breadcrumb: [
    { label: 'Claims', labelKey: 'warranty_claims.nav.claims', href: '/backend/warranty_claims' },
    { label: 'Registrations', labelKey: 'warranty_claims.registrations.nav.title', href: '/backend/warranty_claims/registrations' },
    { label: 'New registration', labelKey: 'warranty_claims.registrations.create.title' },
  ],
}
