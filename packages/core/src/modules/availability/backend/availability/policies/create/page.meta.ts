export const metadata = {
  requireAuth: true,
  requireFeatures: ['availability.policies.manage'],
  breadcrumb: [
    { label: 'Availability Policies', labelKey: 'availability.policies.nav.title', href: '/backend/availability/policies' },
    { label: 'Create', labelKey: 'availability.policies.create.title' },
  ],
}
