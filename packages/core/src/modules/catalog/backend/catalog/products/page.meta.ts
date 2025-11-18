import React from 'react'

const productsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M3 7l9-4 9 4-9 4-9-4z' }),
  React.createElement('path', { d: 'M3 7v10l9 4 9-4V7' }),
  React.createElement('path', { d: 'M12 11v10' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.products.view'],
  pageTitle: 'Products & services',
  pageTitleKey: 'catalog.products.page.title',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  pageOrder: 100,
  icon: productsIcon,
  breadcrumb: [{ label: 'Products & services', labelKey: 'catalog.products.page.title' }],
}
