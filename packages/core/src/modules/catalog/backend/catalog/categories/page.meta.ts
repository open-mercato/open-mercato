import React from 'react'

const categoriesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M3 5h6l2 3h10v11H3z' }),
  React.createElement('path', { d: 'M3 5v14' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.categories.view'],
  pageTitle: 'Categories',
  pageTitleKey: 'catalog.categories.page.title',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  pageOrder: 90,
  icon: categoriesIcon,
  breadcrumb: [{ label: 'Categories', labelKey: 'catalog.categories.page.title' }],
}
