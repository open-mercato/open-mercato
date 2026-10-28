export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.leases.manage'],
  pageTitle: 'New lease',
  pageTitleKey: 'property_management.leases.create.title',
  breadcrumb: [
    { label: 'Leases', labelKey: 'property_management.nav.leases', href: '/backend/property_management/leases' },
    { label: 'New lease', labelKey: 'property_management.leases.create.title' },
  ],
} as const
