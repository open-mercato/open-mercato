import React from 'react'

const receiptIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 4h16v16l-3-2-3 2-3-2-3 2-3-2z' }),
  React.createElement('path', { d: 'M8 9h8' }),
  React.createElement('path', { d: 'M8 13h8' }),
  React.createElement('path', { d: 'M8 17h4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.orders.view'],
  pageTitle: 'Orders',
  pageTitleKey: 'sales.orders.list.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 40,
  pageOrder: 90,
  icon: receiptIcon,
  breadcrumb: [{ label: 'Orders', labelKey: 'sales.orders.list.title' }],
} as const
