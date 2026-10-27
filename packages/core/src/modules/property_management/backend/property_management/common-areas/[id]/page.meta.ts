export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.manage'],
  pageTitle: 'Edit common area',
  pageTitleKey: 'property_management.commonAreas.page.edit',
  breadcrumb: [
    { label: 'Buildings', labelKey: 'property_management.nav.buildings', href: '/backend/property_management/buildings' },
    { label: 'Edit common area', labelKey: 'property_management.commonAreas.page.edit' },
  ],
} as const
