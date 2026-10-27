export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.view'],
  pageTitle: 'Building',
  pageTitleKey: 'property_management.buildings.edit.pageTitle',
  breadcrumb: [
    { label: 'Buildings', labelKey: 'property_management.nav.buildings', href: '/backend/property_management/buildings' },
    { label: 'Building', labelKey: 'property_management.buildings.edit.pageTitle' },
  ],
} as const
