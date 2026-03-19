import React from 'react'

const shieldIcon = React.createElement(
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
  React.createElement('path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_accounts.view'],
  pageTitle: 'Customer Roles',
  pageTitleKey: 'customer_accounts.nav.roles',
  pageGroup: 'Customers',
  pageGroupKey: 'customer_accounts.nav.group',
  pageOrder: 156,
  icon: shieldIcon,
  breadcrumb: [
    { label: 'Customer Accounts', labelKey: 'customer_accounts.nav.users', href: '/backend/customer_accounts' },
    { label: 'Roles', labelKey: 'customer_accounts.nav.roles' },
  ],
} as const
