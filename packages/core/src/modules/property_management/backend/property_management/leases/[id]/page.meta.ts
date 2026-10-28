export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.view'],
  pageTitle: 'Lease',
  pageTitleKey: 'property_management.leases.detail.pageTitle',
  breadcrumb: [
    { label: 'Leases', labelKey: 'property_management.nav.leases', href: '/backend/property_management/leases' },
    { label: 'Lease', labelKey: 'property_management.leases.detail.pageTitle' },
  ],
} as const
