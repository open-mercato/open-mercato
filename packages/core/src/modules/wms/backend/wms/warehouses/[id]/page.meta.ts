export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.manage_warehouses'],
  pageTitle: 'Edit warehouse',
  pageTitleKey: 'wms.warehouses.detail.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Warehouses', labelKey: 'wms.warehouses.list.title', href: '/backend/wms/warehouses' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
