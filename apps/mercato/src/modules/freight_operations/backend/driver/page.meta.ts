export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.driver_app'],
  pageTitle: 'Driver workspace',
  pageTitleKey: 'freight_operations.driver.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 205,
  icon: 'truck',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Driver workspace', labelKey: 'freight_operations.driver.title' },
  ],
}
