export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.manage'],
  pageTitle: 'Edit unit',
  pageTitleKey: 'property_management.units.page.edit',
  breadcrumb: [
    { label: 'Buildings', labelKey: 'property_management.nav.buildings', href: '/backend/property_management/buildings' },
    { label: 'Edit unit', labelKey: 'property_management.units.page.edit' },
  ],
} as const
