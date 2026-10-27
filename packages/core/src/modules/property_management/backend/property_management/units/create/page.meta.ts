export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.manage'],
  pageTitle: 'New unit',
  pageTitleKey: 'property_management.units.page.create',
  breadcrumb: [
    { label: 'Buildings', labelKey: 'property_management.nav.buildings', href: '/backend/property_management/buildings' },
    { label: 'New unit', labelKey: 'property_management.units.page.create' },
  ],
} as const
