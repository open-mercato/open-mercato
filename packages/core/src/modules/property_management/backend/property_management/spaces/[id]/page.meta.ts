export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.manage'],
  pageTitle: 'Edit space',
  pageTitleKey: 'property_management.spaces.page.edit',
  breadcrumb: [
    { label: 'Buildings', labelKey: 'property_management.nav.buildings', href: '/backend/property_management/buildings' },
    { label: 'Edit space', labelKey: 'property_management.spaces.page.edit' },
  ],
} as const
