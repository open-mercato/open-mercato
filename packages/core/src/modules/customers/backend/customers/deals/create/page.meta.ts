import React from 'react'

const createIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
  React.createElement('path', { d: 'M14 2v6h6' }),
  React.createElement('path', { d: 'M12 13v6' }),
  React.createElement('path', { d: 'M9 16h6' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.deals.manage'],
  pageTitle: 'Create deal',
  pageTitleKey: 'customers.deals.create.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pagePriority: 10,
  pageOrder: 121,
  icon: createIcon,
  breadcrumb: [
    { label: 'Deals', labelKey: 'customers.nav.deals', href: '/backend/customers/deals' },
    { label: 'Create', labelKey: 'customers.deals.create.title' },
  ],
}
