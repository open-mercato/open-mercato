import React from 'react'

const creditMemoIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' }),
  React.createElement('path', { d: 'M14 2v6h6' }),
  React.createElement('path', { d: 'M8 15h8' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.credit_memos.manage'],
  pageTitle: 'Credit Memos',
  pageTitleKey: 'sales.credit_memos.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 40,
  pageOrder: 120,
  icon: creditMemoIcon,
  breadcrumb: [{ label: 'Credit Memos', labelKey: 'sales.credit_memos.title' }],
} as const
