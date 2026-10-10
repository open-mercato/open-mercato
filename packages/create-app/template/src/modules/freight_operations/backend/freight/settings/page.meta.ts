export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.settings.manage'],
  pageTitle: 'Freight settings',
  pageTitleKey: 'freight_operations.settings.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 250,
  icon: 'settings',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Settings', labelKey: 'freight_operations.settings.title' },
  ],
}
