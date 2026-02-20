import React from 'react'

const warehouseIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M3 21h18' }),
  React.createElement('path', { d: 'M3 7l9-4 9 4' }),
  React.createElement('path', { d: 'M5 7v14' }),
  React.createElement('path', { d: 'M19 7v14' }),
  React.createElement('path', { d: 'M9 21v-6h6v6' }),
  React.createElement('path', { d: 'M3 11h18' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'Warehouses',
  pageTitleKey: 'wms.warehouses.list.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pagePriority: 50,
  pageOrder: 10,
  icon: warehouseIcon,
  breadcrumb: [{ label: 'Warehouses', labelKey: 'wms.warehouses.list.title' }],
}
