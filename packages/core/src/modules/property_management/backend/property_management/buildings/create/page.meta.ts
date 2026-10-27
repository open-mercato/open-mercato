export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.manage'],
  pageTitle: 'New building',
  pageTitleKey: 'property_management.buildings.create.title',
  breadcrumb: [
    { label: 'Buildings', labelKey: 'property_management.nav.buildings', href: '/backend/property_management/buildings' },
    { label: 'New building', labelKey: 'property_management.buildings.create.title' },
  ],
} as const
