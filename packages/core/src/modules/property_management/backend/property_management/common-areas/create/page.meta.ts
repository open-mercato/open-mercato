export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.manage'],
  pageTitle: 'New common area',
  pageTitleKey: 'property_management.commonAreas.page.create',
  breadcrumb: [
    { label: 'Buildings', labelKey: 'property_management.nav.buildings', href: '/backend/property_management/buildings' },
    { label: 'New common area', labelKey: 'property_management.commonAreas.page.create' },
  ],
} as const
