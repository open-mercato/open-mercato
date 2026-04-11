import React from 'react'

const invoiceIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' }),
  React.createElement('path', { d: 'M14 2v6h6' }),
  React.createElement('path', { d: 'M8 13h8' }),
  React.createElement('path', { d: 'M8 17h8' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.invoices.manage'],
  pageTitle: 'Invoices',
  pageTitleKey: 'sales.invoices.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 40,
  pageOrder: 110,
  icon: invoiceIcon,
  breadcrumb: [{ label: 'Invoices', labelKey: 'sales.invoices.title' }],
} as const
