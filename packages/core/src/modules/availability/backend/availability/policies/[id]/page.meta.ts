export const metadata = {
  requireAuth: true,
  requireFeatures: ['availability.policies.view'],
  breadcrumb: [
    { label: 'Availability Policies', labelKey: 'availability.policies.nav.title', href: '/backend/availability/policies' },
    { label: 'Edit', labelKey: 'availability.policies.edit.title' },
  ],
}
