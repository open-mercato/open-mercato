import React from 'react'

const plusIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
  React.createElement('path', { d: 'M12 8v8' }),
  React.createElement('path', { d: 'M8 12h8' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.products.manage'],
  pageTitle: 'Create product',
  pageTitleKey: 'catalog.products.create.title',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  icon: plusIcon,
  breadcrumb: [
    { label: 'Products & services', labelKey: 'catalog.products.page.title', href: '/backend/catalog/products' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
