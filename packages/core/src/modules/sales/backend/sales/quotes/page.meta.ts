import React from 'react'

const speechIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 5h16v10H7l-3 4z' }),
  React.createElement('path', { d: 'M8 9h8' }),
  React.createElement('path', { d: 'M8 13h5' }),
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
  icon: speechIcon,
  breadcrumb: [{ label: 'Quotes', labelKey: 'sales.quotes.list.title' }],
} as const
