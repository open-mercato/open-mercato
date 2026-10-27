export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.view'],
  pageTitle: 'Floor',
  pageTitleKey: 'property_management.floors.page.title',
  breadcrumb: [
    { label: 'Buildings', labelKey: 'property_management.nav.buildings', href: '/backend/property_management/buildings' },
    { label: 'Floor', labelKey: 'property_management.floors.page.title' },
  ],
} as const
