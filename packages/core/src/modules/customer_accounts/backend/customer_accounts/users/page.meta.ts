import React from 'react'

const usersIcon = React.createElement(
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
  React.createElement('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
  React.createElement('path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }),
  React.createElement('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_accounts.view'],
  pageTitle: 'Users',
  pageTitleKey: 'customer_accounts.nav.users',
  pageGroup: 'Customer Portal',
  pageGroupKey: 'customer_accounts.settings.section',
  pageOrder: 1,
  icon: usersIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Users', labelKey: 'customer_accounts.nav.users' },
  ],
} as const
