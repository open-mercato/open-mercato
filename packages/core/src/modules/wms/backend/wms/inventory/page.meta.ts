import React from 'react'

const inventoryIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M3 7l9-4 9 4-9 4-9-4z' }),
  React.createElement('path', { d: 'M3 7v10l9 4 9-4V7' }),
  React.createElement('path', { d: 'M12 11v10' }),
  React.createElement('path', { d: 'M7.5 9l9-4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'Inventory',
  pageTitleKey: 'wms.inventory.list.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pagePriority: 50,
  pageOrder: 30,
  icon: inventoryIcon,
  breadcrumb: [{ label: 'Inventory', labelKey: 'wms.inventory.list.title' }],
}
