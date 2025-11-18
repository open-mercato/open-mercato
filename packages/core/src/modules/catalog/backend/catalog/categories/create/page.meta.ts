import React from 'react'

const createIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 5v14' }),
  React.createElement('path', { d: 'M5 12h14' }),
  React.createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.categories.manage'],
  pageTitle: 'Create Category',
  pageTitleKey: 'catalog.categories.form.createTitle',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  icon: createIcon,
  breadcrumb: [
    { label: 'Categories', labelKey: 'catalog.categories.page.title', href: '/backend/catalog/categories' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
