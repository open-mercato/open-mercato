import React from 'react'

const cartIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 9, cy: 20, r: 1.5 }),
  React.createElement('circle', { cx: 17, cy: 20, r: 1.5 }),
  React.createElement('path', { d: 'M3 4h2l1 10h11l2-7H6' }),
  React.createElement('path', { d: 'M5 6h15' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.quotes.view'],
  pageTitle: 'Quotes',
  pageTitleKey: 'sales.quotes.list.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 40,
  pageOrder: 100,
  icon: cartIcon,
  breadcrumb: [{ label: 'Quotes', labelKey: 'sales.quotes.list.title' }],
} as const
