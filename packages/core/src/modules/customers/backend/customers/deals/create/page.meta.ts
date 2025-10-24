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
  React.createElement('path', { d: 'M12 5v14' }),
  React.createElement('path', { d: 'M5 12h14' }),
  React.createElement('path', { d: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z' }),
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
