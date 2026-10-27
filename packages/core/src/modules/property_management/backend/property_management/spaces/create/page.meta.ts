export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.manage'],
  pageTitle: 'New space',
  pageTitleKey: 'property_management.spaces.page.create',
  breadcrumb: [
    { label: 'Buildings', labelKey: 'property_management.nav.buildings', href: '/backend/property_management/buildings' },
    { label: 'New space', labelKey: 'property_management.spaces.page.create' },
  ],
} as const
