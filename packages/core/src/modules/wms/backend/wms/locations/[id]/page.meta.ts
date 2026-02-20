export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.manage_warehouses'],
  pageTitle: 'Edit location',
  pageTitleKey: 'wms.locations.detail.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Locations', labelKey: 'wms.locations.list.title', href: '/backend/wms/locations' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
