import React from 'react'

const quoteIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 5h16v14H4z' }),
  React.createElement('path', { d: 'M8 9h8' }),
  React.createElement('path', { d: 'M8 13h6' }),
  React.createElement('path', { d: 'M8 17h4' }),
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
  icon: quoteIcon,
  breadcrumb: [{ label: 'Quotes', labelKey: 'sales.quotes.list.title' }],
} as const
